-- email_log tem organization_id: aplica o mesmo isolamento das demais tabelas (leitura só da própria org).
alter table email_log enable row level security;
create policy tenant_read on email_log for select using (organization_id = (select app_current_org()));
grant select on email_log to app_user;
