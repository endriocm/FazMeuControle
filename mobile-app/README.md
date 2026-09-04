# RumoFi — aplicativo Android

Aplicativo independente de controle financeiro pessoal. Esta pasta tem identidade, pacote Android e armazenamento próprios e não compartilha cadastros ou dados com outro produto.

## Estado atual

- Entradas, despesas, recorrências, cartões, faturas, categorias, investimentos e planejamento financeiro.
- Cadastro e login por e-mail no projeto Firebase exclusivo do RumoFi.
- Perfil com nome, e-mail, telefone e consentimentos opcionais separados para e-mail e WhatsApp/SMS.
- Dados iniciados vazios, mantidos no aparelho e sincronizados por usuário após cada salvamento.
- Recuperação de senha, edição do perfil, encerramento da sessão e exclusão da conta dentro do app.
- Backup e restauração por arquivo TXT.
- Gráficos e exportação para Excel empacotados no aplicativo, sem depender de CDN.
- Permissão de internet limitada às integrações necessárias, como autenticação e sincronização.
- Projeto Android criado com Capacitor.
- Nome definido: `RumoFi`.
- Identificador técnico provisório: `app.fazmeucontrole.mobile`.

O identificador técnico deve ser confirmado antes da primeira publicação. Depois que o pacote entrar na Play Store, ele não deve ser trocado.

## Desenvolvimento

```powershell
npm install
npm test
npm run build
npm run android:add
npm run android:sync
npm run android:open
```

Para gerar um APK de depuração:

```powershell
npm run android:debug
```

Para a publicação será necessário configurar uma chave de assinatura, publicar a política de privacidade e gerar o Android App Bundle. A cobrança recorrente continua sendo uma integração separada e ainda não está habilitada.

Consulte também o [checklist de publicação](./PLAY_STORE.md).
