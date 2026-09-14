-- Reverses 0024.
begin;

drop policy if exists spyglass_widgets_admin_delete on public.spyglass_widgets;
drop policy if exists spyglass_widgets_admin_update on public.spyglass_widgets;
drop policy if exists spyglass_widgets_admin_insert on public.spyglass_widgets;
drop policy if exists spyglass_widgets_read_authenticated on public.spyglass_widgets;
drop policy if exists spyglass_settings_admin_update on public.spyglass_settings;
drop policy if exists spyglass_settings_read_authenticated on public.spyglass_settings;

drop table if exists spyglass_widgets;
drop table if exists spyglass_settings;
drop function if exists public.is_app_administrator();
drop table if exists app_administrators;

commit;
