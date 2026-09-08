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

A base atual exige uma conta RumoFi e sincroniza os dados financeiros entre dispositivos pelo Firebase. O usuário também consegue excluir conta e dados dentro do aplicativo. Assinatura e restauração de compra ainda precisam ser implementadas antes de vender acesso recorrente pela Play Store.
