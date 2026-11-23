import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { createHmac, randomUUID } from "node:crypto";

const DB = process.env.E2E_DATABASE_URL ?? "postgres://retoma:retoma@localhost:5432/retoma_e2e";
const shots = process.env.SCREENSHOT_DIR;

test("cadastro → demonstração → contato → negócio → WhatsApp → Radar", async ({ page, request }) => {
  const email = `e2e-${randomUUID().slice(0, 8)}@teste.com`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Nenhuma venda esquecida/ })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/01-home.png`, fullPage: true });

  // Cadastro
  await page.getByRole("link", { name: "Testar grátis" }).click();
  await page.getByLabel("Seu nome").fill("Dra. Teste");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("senha-muito-forte");
  await page.getByLabel("Nome da empresa").fill("Clínica Sorriso E2E");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Conta criada!")).toBeVisible();

  // Demonstração
  await page.getByRole("button", { name: "Carregar demonstração" }).click();
  await expect(page.getByRole("button", { name: "Remover dados de demonstração" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/02-painel.png`, fullPage: true });

  await page.getByRole("link", { name: /Radar/ }).first().click();
  await expect(page.getByRole("link", { name: "Mariana Costa (DEMO)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ricardo Alves (DEMO)" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/03-radar.png`, fullPage: true });

  // Contato manual + negócio
  await page.goto("/app/contacts/new");
  await page.getByLabel("Nome").fill("Helena Souza");
  await page.getByLabel("Telefone (WhatsApp)").fill("(21) 98888-7777");
  await page.getByRole("button", { name: "Salvar contato" }).click();
  await expect(page.getByRole("heading", { name: "Helena Souza" })).toBeVisible();
  await page.getByLabel("Novo negócio").fill("Clareamento");
  await page.getByLabel("Valor (R$)").fill("1.500,00");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText("R$ 1.500")).toBeVisible();

  // Mover no funil para "Tratamento fechado"
  await page.goto("/app/pipeline");
  const card = page.locator("article", { hasText: "Helena Souza" });
  await card.getByLabel("Mover para etapa").selectOption({ label: "Tratamento fechado" });
  await card.getByRole("button", { name: "Mover" }).click();
  await expect(page.locator("section[aria-label='Tratamento fechado']").getByText("Helena Souza")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/04-funil.png`, fullPage: true });

  // Conecta um número (direto no banco: a validação real exige a Meta) e simula webhook assinado
  const db = new Client({ connectionString: DB });
  await db.connect();
  const org = (await db.query("select o.id from organizations o join memberships m on m.organization_id = o.id join users u on u.id = m.user_id where u.email = $1", [email])).rows[0].id;
  const phoneId = String(Date.now());
  await db.query("insert into channel_accounts (organization_id, waba_id, phone_number_id, display_phone, access_token_encrypted) values ($1,'123',$2,'+55 11 4000-0000','v1.x.x.x')", [org, phoneId]);
  await db.end();

  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "123", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "551140000000", phone_number_id: phoneId },
    contacts: [{ profile: { name: "Lucas Prado" }, wa_id: "5511955554444" }],
    messages: [{ from: "5511955554444", id: `wamid.e2e.${phoneId}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Olá! Quanto custa uma limpeza?" } }],
  } }] }] });
  const bad = await request.post("/api/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" } });
  expect(bad.status()).toBe(401);
  const sig = "sha256=" + createHmac("sha256", "e2e-app-secret").update(body).digest("hex");
  const ok = await request.post("/api/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": sig } });
  expect(ok.status()).toBe(200);

  // O worker processa e a conversa aparece na caixa de entrada
  await page.goto("/app/inbox");
  await expect(page.getByText("Lucas Prado").first()).toBeVisible({ timeout: 15_000 });
  await page.getByText("Lucas Prado").first().click();
  await expect(page.getByText("Olá! Quanto custa uma limpeza?").last()).toBeVisible();
  await expect(page.getByPlaceholder("Escreva sua resposta…")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/05-conversas.png`, fullPage: true });

  // Telas restantes carregam
  await page.goto("/app/contacts");
  await expect(page.getByText("Lucas Prado")).toBeVisible();
  await page.goto("/app/settings");
  await expect(page.getByText("Conectado")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/06-config.png`, fullPage: true });

  // Agenda: demonstração visível, cadastro de profissional e agendamento por horário livre
  await page.goto("/app/agenda");
  await expect(page.getByText("Dra. Exemplo (DEMO)")).toBeVisible();
  await page.goto("/app/agenda/settings");
  await page.getByLabel("Nome do profissional").fill("Dra. Paula");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Horário de Dra. Paula" })).toBeVisible();
  const spDate = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + 86400_000 * n));
  let offset = 7;
  while ([0, 6].includes(new Date(`${spDate(offset)}T12:00:00Z`).getUTCDay())) offset++; // próximo dia útil no fuso da empresa
  const tomorrow = spDate(offset);
  await page.goto(`/app/agenda?date=${tomorrow}&novo=1`);
  await page.getByLabel("Cliente").selectOption({ label: "Helena Souza" });
  await page.getByLabel("Profissional").selectOption({ label: "Dra. Paula" });
  const slot = page.getByRole("radio").first();
  await expect(slot).toBeVisible();
  {
    await slot.click();
    await page.getByRole("button", { name: "Agendar" }).click();
    await expect(page.getByText("Agendamento criado.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Helena Souza, Agendado/ })).toBeVisible();
    await page.getByRole("link", { name: /Helena Souza, Agendado/ }).click();
    await page.getByRole("button", { name: "Confirmar presença" }).click();
    await expect(page.getByText("Confirmado").first()).toBeVisible();
  }
  if (shots) await page.screenshot({ path: `${shots}/09-agenda.png`, fullPage: true });

  // Automação a partir de modelo: ativa e executa para um novo contato (processada pelo worker)
  await page.goto("/app/automations");
  await page.locator("li", { hasText: "Novo lead" }).getByRole("button", { name: "Usar modelo" }).click();
  await expect(page.getByRole("heading", { name: "Novo lead" })).toBeVisible();
  await page.getByRole("button", { name: "Ativar" }).click();
  await expect(page.getByText("Automação ativada.")).toBeVisible();
  const autoUrl = page.url();
  await page.goto("/app/contacts/new");
  await page.getByLabel("Nome").fill("Lead da Automação");
  await page.getByRole("button", { name: "Salvar contato" }).click();
  await expect(page.getByRole("heading", { name: "Lead da Automação" })).toBeVisible();
  await expect.poll(async () => { await page.goto(autoUrl); return page.getByText("Concluída").count(); }, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByText("Tarefa criada.")).toHaveCount(1); // só o contato criado depois da ativação
  if (shots) await page.screenshot({ path: `${shots}/10-automacao.png`, fullPage: true });

  // Campanha: consentimento registrado + template aprovado → pré-visualização → aprovação
  const db2 = new Client({ connectionString: DB });
  await db2.connect();
  const ch = (await db2.query("select id from channel_accounts where organization_id = $1", [org])).rows[0].id;
  await db2.query(`insert into message_templates (organization_id, channel_account_id, name, language, category, status, body_text, body_param_count)
    values ($1,$2,'novidades','pt_BR','MARKETING','APPROVED','Oi {{1}}! Temos horários especiais esta semana.',1)`, [org, ch]);
  await db2.end();
  await page.goto("/app/contacts");
  await page.getByRole("link", { name: "Lucas Prado" }).click();
  await page.getByPlaceholder(/Como foi obtido/).fill("Pediu para receber novidades pelo WhatsApp");
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Autorizado")).toBeVisible();
  await page.goto("/app/campaigns");
  await page.getByLabel("Nome da campanha").fill("Horários especiais");
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  await page.getByLabel("Template aprovado").selectOption({ label: "novidades (pt_BR · marketing)" });
  await page.getByRole("button", { name: "Salvar e atualizar pré-visualização" }).click();
  await expect(page.getByText(/podem receber/)).toBeVisible();
  await expect(page.getByText("Oi Lucas! Temos horários especiais esta semana.")).toBeVisible();
  await expect(page.getByText(/excluído\(s\): sem consentimento de marketing registrado/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/11-campanha.png`, fullPage: true });
  await page.getByRole("button", { name: "Aprovar e agendar envio" }).click();
  await expect(page.getByText("Agendada", { exact: true })).toBeVisible();

  // Assistente IA: cadastra catálogo e base; sem chave configurada, a interface avisa e não oferece botões de IA
  await page.goto("/app/knowledge");
  await expect(page.getByText("A IA ainda não está ativa")).toBeVisible();
  await page.getByLabel("Produto ou serviço").fill("Limpeza");
  await page.getByLabel("Preço (R$)").fill("250,00");
  await page.getByRole("button", { name: "Adicionar ao catálogo" }).click();
  await expect(page.getByText("R$ 250,00")).toBeVisible();
  await page.getByLabel("Título").fill("Pagamento");
  await page.getByLabel("Conteúdo").fill("Aceitamos Pix e cartão em até 10x sem juros.");
  await page.getByRole("button", { name: "Adicionar documento" }).click();
  await expect(page.getByText(/Pagamento · FAQ/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/07-assistente.png`, fullPage: true });
  await page.goto("/app/inbox");
  await expect(page.getByRole("button", { name: /Sugerir resposta com IA/ })).toHaveCount(0);

  // Assinatura: plano de teste, consumo e planos (sem gateway configurado neste ambiente)
  await page.goto("/app/billing");
  await expect(page.getByRole("heading", { name: "Plano Teste grátis" })).toBeVisible();
  await expect(page.getByText("Os pagamentos ainda não estão configurados")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profissional" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/12-assinatura.png`, fullPage: true });

  // Sair
  await page.getByRole("button", { name: "Sair" }).last().click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});
