# Faz Meu Controle — aplicativo Android

Aplicativo independente de controle financeiro pessoal. Esta pasta tem identidade, pacote Android e armazenamento próprios e não compartilha cadastros ou dados com outro produto.

## Estado atual

- Entradas, despesas, recorrências, cartões, faturas, categorias, investimentos e planejamento financeiro.
- Dados iniciados vazios e persistidos localmente no aparelho.
- Backup e restauração por arquivo TXT.
- Gráficos e exportação para Excel empacotados no aplicativo, sem depender de CDN.
- Nenhuma permissão de internet na base local atual.
- Projeto Android criado com Capacitor.
- Identificador provisório: `app.fazmeucontrole.mobile`.

O nome e o identificador devem ser confirmados antes da primeira publicação. Depois que o pacote entrar na Play Store, o identificador não deve ser trocado.

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

Para a publicação será necessário configurar uma chave de assinatura e gerar o Android App Bundle. Sincronização entre aparelhos e cobrança recorrente são integrações independentes e não estão habilitadas nesta primeira base local.

Consulte também o [checklist de publicação](./PLAY_STORE.md).
