-- Automações só reagem a eventos ocorridos depois da ativação (não "reprocessam" o passado ao serem ligadas).
alter table automations add column activated_at timestamptz;
update automations set activated_at = updated_at where status = 'active';
