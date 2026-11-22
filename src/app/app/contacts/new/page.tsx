import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createContactAction } from "../../actions";
import { ContactFields } from "../contact-fields";

export const metadata = { title: "Novo contato" };

export default function NewContact() {
  return (
    <>
      <PageHeader title="Novo contato" description={<Link href="/app/contacts" className="hover:underline">← Contatos</Link>} />
      <Card className="max-w-2xl p-5">
        <ActionForm action={createContactAction} className="space-y-4">
          <ContactFields />
          <p className="text-xs text-muted">Cadastrar um contato não autoriza envio de mensagens de marketing. Registre o consentimento na ficha do contato quando obtido.</p>
          <SubmitButton>Salvar contato</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
