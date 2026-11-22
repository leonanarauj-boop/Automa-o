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

  // Sair
  await page.getByRole("button", { name: "Sair" }).last().click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});
