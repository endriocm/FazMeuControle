# RumoFi

Aplicativo independente de controle financeiro pessoal para Android. Este repositório contém um único produto, com a aplicação web empacotada pelo Capacitor e o projeto Android na pasta `android/`.

O RumoFi tem identidade, autenticação, armazenamento e projeto Firebase próprios. Ele não compartilha cadastros nem dados com o CMT ou com outro produto.

## Recursos atuais

- Entradas, despesas, recorrências, cartões, faturas e categorias.
- Investimentos e planejamento financeiro.
- Cadastro e login por e-mail ou Google no Firebase exclusivo do RumoFi.
- Perfil com nome, e-mail, telefone e consentimentos opcionais separados.
- Sincronização dos dados financeiros por usuário.
- Recuperação de senha, encerramento da sessão e exclusão da conta.
- Backup e restauração por arquivo TXT.
- Gráficos e exportação para Excel empacotados no aplicativo, sem CDN.

## Identidade Android

- Nome exibido: `RumoFi`.
- Identificador atual: `app.fazmeucontrole.mobile`.

O identificador está registrado no Firebase e deve ser confirmado antes da primeira publicação na Play Store. Depois da publicação, ele não poderá ser trocado.

O arquivo `android/app/google-services.json` é necessário para o login Google, mas permanece apenas no ambiente local e não deve ser versionado.

## Desenvolvimento

```powershell
npm install
npm test
npm run build
npm run android:sync
npm run android:open
```

Para gerar um APK de depuração:

```powershell
npm run android:debug
```

Para publicar, ainda é necessário configurar uma chave de assinatura, publicar a política de privacidade e gerar o Android App Bundle. Consulte [PLAY_STORE.md](./PLAY_STORE.md).
