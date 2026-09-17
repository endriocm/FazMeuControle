# RumoFi: planos e anúncios

## Regras aprovadas

- Download gratuito; público-alvo de 18 anos ou mais.
- Gratuito: um bloco, com lançamentos no bloco e anúncios no Android.
- Premium: R$ 20 por mês, vários blocos, planejamento financeiro e sem anúncios.
- Ao encerrar o Premium, os registros existentes permanecem acessíveis. A criação de blocos adicionais exige renovar a assinatura.
- O app consulta `entitlements/{uid}` no Firestore. Só o servidor pode gravar esse documento. Estado desconhecido oculta os anúncios e aguarda confirmação para liberar novos recursos.

## Google Play

- Pacote: `app.fazmeucontrole.mobile`.
- Produto de assinatura: `rumofi_premium`.
- Plano base: `monthly`, renovação mensal automática; preço Brasil: BRL 20,00.
- Validar com compras de teste antes de disponibilizar a venda.
- Configurar a conta de serviço das funções com as permissões de assinatura na Play Console e a API Google Play Android Developer habilitada.
- Configurar as notificações de assinatura (RTDN) no tópico `projects/rumofi-69b1e/topics/rumofi-google-play-rtdn` e conceder publicação a `google-play-developer-notifications@system.gserviceaccount.com`.
- A URL de validação deve ser configurada em `VITE_RUMOFI_BILLING_ENDPOINT` somente após confirmar o deploy e o acesso à API.
- A compra precisa carregar o identificador SHA-256 da conta RumoFi; o servidor compara esse vínculo antes de liberar o acesso.
- A conta exclusiva de revisão recebeu um documento administrativo com `source: store_review`. Não há bypass geral no aplicativo. As credenciais ficam fora do repositório.

## AdMob

- App Android RumoFi: `ca-app-pub-5960094893354416~4672932627`.
- Banner gratuito: `ca-app-pub-5960094893354416/5367067192`.
- Debug usa o banner de teste do Google; release usa o banner acima.
- Consentimento UMP antes de iniciar o SDK de publicidade. O app solicita anúncios não personalizados e oferece revisão das opções de privacidade quando exigida.
- Banner oculto em formulários, login, planejamento, assinatura e segundo plano; destruído ao sair ou ativar Premium.
- Depois da publicação, vincular o pacote na AdMob e concluir a revisão do app. A aprovação da conta AdMob não confirma a aprovação do aplicativo.
- Site do desenvolvedor: https://rumofi-69b1e.web.app.
- `app-ads.txt`: https://rumofi-69b1e.web.app/app-ads.txt.

## Contato e páginas públicas

- Suporte: endriocardoso964@gmail.com.
- Política: https://rumofi-69b1e.web.app/privacy.
- Exclusão: https://rumofi-69b1e.web.app/delete-account.
- As páginas são publicadas com `firebase deploy --only hosting --project rumofi-69b1e`.

## Validação Android no Windows

Use JDK 21; o JBR 25 do Android Studio atual não é compatível com o Gradle deste projeto. Neste ambiente, o JDK 21 está em `C:/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot`.

Para usar as autoridades certificadoras já confiadas pelo Windows, quando necessário, execute o Gradle com `-Djavax.net.ssl.trustStoreType=Windows-ROOT -Djavax.net.ssl.trustStore=NONE`. Não desabilite a verificação TLS.

Sincronização, testes unitários e build não substituem a validação do banner e da compra em aparelho Android ou emulador com Google Play.
