import { Field, Input, Select, Textarea } from "@/components/ui";

export function ContactFields({ c, withNotes = false }: { c?: { display_name?: string; phone_e164?: string | null; email?: string | null; company?: string | null; temperature?: string | null; notes?: string | null }; withNotes?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nome" htmlFor="displayName"><Input id="displayName" name="displayName" required defaultValue={c?.display_name} /></Field>
      <Field label="Telefone (WhatsApp)" htmlFor="phone" hint="DDD + número. Ex.: (11) 91234-5678"><Input id="phone" name="phone" inputMode="tel" defaultValue={c?.phone_e164 ?? ""} /></Field>
      <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" defaultValue={c?.email ?? ""} /></Field>
      <Field label="Empresa" htmlFor="company"><Input id="company" name="company" defaultValue={c?.company ?? ""} /></Field>
      <Field label="Temperatura" htmlFor="temperature">
        <Select id="temperature" name="temperature" defaultValue={c?.temperature ?? ""}>
          <option value="">Não definida</option><option value="cold">Frio</option><option value="warm">Morno</option><option value="hot">Quente</option>
        </Select>
      </Field>
      {withNotes && <div className="sm:col-span-2"><Field label="Observações" htmlFor="notes"><Textarea id="notes" name="notes" rows={3} defaultValue={c?.notes ?? ""} /></Field></div>}
    </div>
  );
}
