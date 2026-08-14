-- Core resolver
CREATE OR REPLACE FUNCTION public.can(_action text, _area text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.role_assignments ra
      JOIN public.roles r ON r.id = ra.role_id
      JOIN public.staff s ON s.id = ra.staff_id
      LEFT JOIN public.role_capabilities rc
        ON rc.role_id = r.id AND rc.capability_key = _action
      LEFT JOIN public.capabilities c ON c.key = _action
     WHERE lower(coalesce(s.email, '')) = public.current_email()
       AND s.is_active
       AND ra.revoked_at IS NULL
       AND (ra.start_date IS NULL OR ra.start_date <= current_date)
       AND (ra.end_date IS NULL OR ra.end_date >= current_date)
       AND (
         r.is_superuser
         OR (rc.capability_key IS NOT NULL
             AND (c.area_scoped = false OR ra.area IS NULL OR ra.area = _area))
       )
  )
$$;
REVOKE EXECUTE ON FUNCTION public.can(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can(text, text) TO authenticated, service_role;

-- Full capability set for one staff member in one area (used by the UI + viewer)
CREATE OR REPLACE FUNCTION public.effective_capabilities(_staff_id uuid, _area text DEFAULT NULL)
RETURNS TABLE (capability_key text, via_role text, via_area text, until date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.key, r.label, ra.area, ra.end_date
    FROM public.staff s
    JOIN public.role_assignments ra ON ra.staff_id = s.id
    JOIN public.roles r ON r.id = ra.role_id
    CROSS JOIN public.capabilities c
   WHERE s.id = _staff_id
     AND s.is_active
     AND ra.revoked_at IS NULL
     AND (ra.start_date IS NULL OR ra.start_date <= current_date)
     AND (ra.end_date IS NULL OR ra.end_date >= current_date)
     AND (
       r.is_superuser
       OR (EXISTS (SELECT 1 FROM public.role_capabilities rc
                    WHERE rc.role_id = r.id AND rc.capability_key = c.key)
           AND (c.area_scoped = false OR ra.area IS NULL OR ra.area = _area))
     )
$$;
REVOKE EXECUTE ON FUNCTION public.effective_capabilities(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_capabilities(uuid, text) TO authenticated, service_role;

-- Repoint legacy helpers
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.role_assignments ra
      JOIN public.roles r ON r.id = ra.role_id
      JOIN public.staff s ON s.id = ra.staff_id
     WHERE lower(coalesce(s.email, '')) = public.current_email()
       AND s.is_active AND r.is_superuser AND ra.revoked_at IS NULL
       AND (ra.start_date IS NULL OR ra.start_date <= current_date)
       AND (ra.end_date IS NULL OR ra.end_date >= current_date)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_area_manager_of(_area text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can('schedule.edit', _area)
$$;

CREATE OR REPLACE FUNCTION public.is_supervisor_of(_area text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can('leave.manage', _area)
$$;

-- Safety rails: roles
CREATE OR REPLACE FUNCTION public.guard_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_builtin THEN RAISE EXCEPTION 'Built-in roles cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_builtin AND NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'Built-in roles cannot be renamed';
    END IF;
    IF OLD.is_superuser AND NOT NEW.is_superuser THEN
      RAISE EXCEPTION 'The Admin role must keep full access';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.is_superuser THEN
    RAISE EXCEPTION 'Additional all-access roles cannot be created';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_roles BEFORE INSERT OR UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_roles();

-- Safety rails: the Admin role's capability rows are not editable
CREATE OR REPLACE FUNCTION public.guard_role_capabilities()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE su boolean;
BEGIN
  SELECT is_superuser INTO su FROM public.roles
   WHERE id = coalesce(NEW.role_id, OLD.role_id);
  IF su THEN RAISE EXCEPTION 'The Admin role always has every capability'; END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_role_capabilities
  BEFORE INSERT OR UPDATE OR DELETE ON public.role_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.guard_role_capabilities();

-- Safety rails: last admin / self-revocation
CREATE OR REPLACE FUNCTION public.guard_role_assignments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  was_admin boolean;
  still_admin boolean;
  target_email text;
  admins_left int;
BEGIN
  SELECT r.is_superuser INTO was_admin FROM public.roles r WHERE r.id = OLD.role_id;
  IF NOT coalesce(was_admin, false) THEN RETURN coalesce(NEW, OLD); END IF;

  still_admin := TG_OP = 'UPDATE' AND NEW.revoked_at IS NULL
                 AND (NEW.end_date IS NULL OR NEW.end_date >= current_date);
  IF still_admin THEN RETURN NEW; END IF;

  SELECT lower(coalesce(s.email, '')) INTO target_email FROM public.staff s WHERE s.id = OLD.staff_id;
  IF target_email = public.current_email() AND public.current_email() <> '' THEN
    RAISE EXCEPTION 'You cannot remove your own admin access — ask another admin';
  END IF;

  SELECT count(*) INTO admins_left
    FROM public.role_assignments ra
    JOIN public.roles r ON r.id = ra.role_id
    JOIN public.staff s ON s.id = ra.staff_id
   WHERE r.is_superuser AND ra.revoked_at IS NULL AND s.is_active
     AND ra.id <> OLD.id
     AND (ra.end_date IS NULL OR ra.end_date >= current_date);
  IF admins_left = 0 THEN
    RAISE EXCEPTION 'At least one active admin must remain';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER trg_guard_role_assignments
  BEFORE UPDATE OR DELETE ON public.role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_role_assignments();

-- Audit every permission change
CREATE OR REPLACE FUNCTION public.audit_permission_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs (action, entity_type, entity_id, details)
  VALUES (lower(TG_TABLE_NAME) || '.' || lower(TG_OP), TG_TABLE_NAME,
          coalesce((to_jsonb(NEW) ->> 'id'), (to_jsonb(OLD) ->> 'id')),
          jsonb_build_object('before', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
                             'after',  CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END));
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER trg_audit_roles AFTER INSERT OR UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_permission_change();
CREATE TRIGGER trg_audit_role_capabilities AFTER INSERT OR UPDATE OR DELETE ON public.role_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.audit_permission_change();
CREATE TRIGGER trg_audit_role_assignments AFTER INSERT OR UPDATE OR DELETE ON public.role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_permission_change();

-- Write access to the permission tables follows the new capabilities
DROP POLICY IF EXISTS "roles admin write" ON public.roles;
CREATE POLICY "roles managed" ON public.roles FOR ALL TO authenticated
  USING (public.can('roles.manage')) WITH CHECK (public.can('roles.manage'));
DROP POLICY IF EXISTS "role caps admin write" ON public.role_capabilities;
CREATE POLICY "role caps managed" ON public.role_capabilities FOR ALL TO authenticated
  USING (public.can('roles.manage')) WITH CHECK (public.can('roles.manage'));
DROP POLICY IF EXISTS "assignments admin write" ON public.role_assignments;
CREATE POLICY "assignments managed" ON public.role_assignments FOR ALL TO authenticated
  USING (public.can('assignments.manage', area)) WITH CHECK (public.can('assignments.manage', area));
DROP POLICY IF EXISTS "aliases admin write" ON public.area_aliases;
CREATE POLICY "aliases managed" ON public.area_aliases FOR ALL TO authenticated
  USING (public.can('directory.edit', NULL) OR public.is_admin())
  WITH CHECK (public.can('directory.edit', NULL) OR public.is_admin());