# Checklist de publicação na Play Store

## Antes do primeiro envio

- Confirmar o nome comercial do aplicativo.
- Confirmar o identificador definitivo do pacote Android.
- Definir o modelo de venda: download pago ou assinatura dentro do aplicativo.
- Criar a política de privacidade e preencher a seção de segurança dos dados.
- Preparar ícone, imagens da loja, descrição curta e descrição completa.

## Compilação assinada

1. Instalar o Android Studio com o SDK Android 36.
2. Criar uma chave de upload e guardá-la fora do repositório.
3. Configurar a assinatura da variante `release` localmente.
4. Atualizar `versionCode` e `versionName`.
5. Executar `npm run android:bundle`.
6. Enviar o arquivo AAB assinado para uma faixa de teste interno.

## Produto

A base atual funciona sem conta e salva os dados apenas no aparelho, com backup manual. Se a venda exigir assinatura, restauração de compra ou sincronização entre aparelhos, essas funções devem usar serviços próprios do produto antes da publicação.
