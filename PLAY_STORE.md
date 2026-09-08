# Checklist de publicação na Play Store

## Antes do primeiro envio

- Confirmar o nome comercial do aplicativo.
- Confirmar o identificador definitivo do pacote Android.
- Definir o modelo de venda: download pago ou assinatura dentro do aplicativo.
- Publicar a política de privacidade em uma URL pública e preencher a seção de segurança dos dados.
- Declarar coleta de nome, e-mail, telefone, identificador da conta e dados financeiros informados pelo usuário.
- Informar que os dados são usados para conta, suporte e sincronização; marketing depende de autorização opcional.
- Informar no formulário de segurança que os dados trafegam com criptografia do Firebase.
- Disponibilizar também fora do aplicativo uma página pública para solicitar exclusão da conta.
- Preparar ícone, imagens da loja, descrição curta e descrição completa.

## Compilação assinada

1. Instalar o Android Studio com o SDK Android 36.
2. Criar uma chave de upload e guardá-la fora do repositório.
3. Configurar a assinatura da variante `release` localmente.
4. Atualizar `versionCode` e `versionName`.
5. Executar `npm run android:bundle`.
6. Enviar o arquivo AAB assinado para uma faixa de teste interno.

## Produto

A base atual exige uma conta RumoFi e sincroniza os dados financeiros entre dispositivos pelo Firebase. O usuário também consegue excluir conta e dados dentro do aplicativo.

## Assinatura Google Play

O aplicativo já possui a tela de assinatura, restauração, gerenciamento da compra e o plugin nativo de Billing. O backend em `functions/` valida o token com a Google Play Developer API antes de gravar o entitlement em `entitlements/{uid}`.

1. No Play Console, criar uma assinatura com o ID `rumofi_premium` e o plano base `monthly` (ou trocar os dois valores no `.env.local` e em `functions/.env`).
2. Vincular no Play Console a conta de serviço usada pelo Firebase com permissão para consultar e reconhecer compras.
3. Criar o tópico Pub/Sub `rumofi-google-play-rtdn` e apontá-lo nas Real-time developer notifications da assinatura.
4. Instalar as dependências e publicar as funções: `npm install --prefix functions` e `firebase deploy --only functions`.
5. Copiar `.env.example` para `.env.local`, preencher o endpoint da função e gerar o build Android novamente.
6. Publicar primeiro em teste interno. A compra só pode ser testada instalando o app pela Play Store com uma conta de licença/teste; um APK instalado diretamente não testa a cobrança.

O preço não é codificado no app: ele é exibido pela Google Play. O valor, país, período de cobrança, política de privacidade e conta de teste ainda precisam ser definidos no Play Console.
