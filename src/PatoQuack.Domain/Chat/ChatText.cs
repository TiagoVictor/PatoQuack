namespace PatoQuack.Domain.Chat;

public enum ChatTextProblem
{
    None,
    Empty,
    TooLong,
    InvalidCharacters,
}

/// <summary>Regras do texto de uma mensagem.</summary>
public static class ChatText
{
    public const int DefaultMaxLength = 2000;

    /// <summary>
    /// Normaliza quebras de linha e espaços das pontas e recusa vazio, texto longo demais ou
    /// caracteres de controle (exceto quebra de linha e tab).
    /// </summary>
    public static ChatTextProblem Normalize(string? text, int maxLength, out string normalized)
    {
        normalized = (text ?? string.Empty).Replace("\r\n", "\n").Replace('\r', '\n').Trim();
        if (normalized.Length == 0)
        {
            return ChatTextProblem.Empty;
        }

        if (normalized.Length > maxLength)
        {
            return ChatTextProblem.TooLong;
        }

        return normalized.Any(c => char.IsControl(c) && c is not '\n' and not '\t')
            ? ChatTextProblem.InvalidCharacters
            : ChatTextProblem.None;
    }
}
