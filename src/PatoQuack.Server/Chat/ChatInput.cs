using Microsoft.AspNetCore.SignalR;

namespace PatoQuack.Server.Chat;

/// <summary>Validação do texto de uma mensagem (o cliente valida também, mas não é confiável).</summary>
public static class ChatInput
{
    /// <summary>
    /// Normaliza quebras de linha, tira espaços das pontas e recusa vazio, texto longo demais ou
    /// caracteres de controle (exceto quebra de linha e tab).
    /// </summary>
    public static string NormalizeText(string? text, int maxLength)
    {
        var value = (text ?? string.Empty).Replace("\r\n", "\n").Replace('\r', '\n').Trim();
        if (value.Length == 0)
        {
            throw new HubException("A mensagem está vazia.");
        }

        if (value.Length > maxLength)
        {
            throw new HubException($"A mensagem passou de {maxLength} caracteres.");
        }

        if (value.Any(c => char.IsControl(c) && c is not '\n' and not '\t'))
        {
            throw new HubException("A mensagem tem caracteres inválidos.");
        }

        return value;
    }
}
