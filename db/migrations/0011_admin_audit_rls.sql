-- admin_audit tem organization_id: mesmo isolamento das demais tabelas (a empresa só vê ações sobre ela).
alter table admin_audit enable row level security;
create policy tenant_read on admin_audit for select using (organization_id = (select app_current_org()));
grant select on admin_audit to app_user;
