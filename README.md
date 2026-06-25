# Faz Meu Controle

Controle financeiro estático hospedado na Vercel, com login, sincronização por usuário, pagamento pelo Mercado Pago e liberação alternativa por código de acesso.

## Arquitetura

- `index.html`: controle financeiro e seus lançamentos;
- `auth.js`: cadastro por e-mail/senha, Google e bloqueio de acesso até a liberação;
- Firestore: um documento financeiro por usuário autenticado;
- `api/`: funções serverless da Vercel. Tokens privados nunca chegam ao navegador;
- Mercado Pago: cria a assinatura mensal, confirma o retorno e recebe a notificação de pagamento;
- Códigos: gerados e validados no servidor usando o Firebase Admin.

## Configuração obrigatória

1. Crie um projeto no Firebase e habilite **Authentication** com os provedores **E-mail/senha** e **Google**.
2. Em Authentication > Settings > Authorized domains, adicione o domínio de produção da Vercel.
3. Crie o banco **Cloud Firestore** em modo produção e publique as regras de [`firestore.rules`](./firestore.rules).
4. Crie uma conta de serviço no Firebase (Project settings > Service accounts) e use seus dados apenas nas variáveis privadas da Vercel.
5. Para ativar cobranças, no Mercado Pago obtenha um Access Token de produção e cadastre `https://faz-meu-controle.vercel.app/api/mercadopago-webhook` como notificação de pagamentos.
6. Na Vercel, defina as variáveis do Firebase listadas em [`.env.example`](./.env.example). Para cobranças, inclua também `MERCADO_PAGO_ACCESS_TOKEN` e `APP_URL`; a URL não deve ter barra no final.

Para tornar uma conta administradora de códigos, crie no Firestore o documento `administrators/UID_DO_USUARIO` com o campo booleano `active: true`. O UID aparece no Firebase Authentication após o primeiro login.

## Acesso e dados

O usuário cria uma conta ou entra com Google, mas só acessa o painel após assinatura aprovada, resgate de código ou e-mail cadastrado em `FREE_ACCESS_EMAILS`. Os lançamentos são mantidos no `localStorage` como cópia local e sincronizados em `financialData/{uid}` após a liberação.

## Desenvolvimento e deploy

```powershell
npm install
npx vercel dev
```

Na Vercel, use esta pasta (`controle-financeiro-vercel`) como **Root Directory**. O deploy instala `firebase-admin` para as funções em `api/` automaticamente.

> Nunca preencha um Access Token do Mercado Pago ou uma chave privada do Firebase no HTML, no Git ou em um arquivo versionado.
