using System.Net.Mail;

namespace PatoQuack.Domain.Users;

public static class EmailAddress
{
    public const int MaxLength = 254;

    /// <summary>Remove espaços, passa para minúsculas e valida o formato. Null se inválido.</summary>
    public static string? Normalize(string? value)
    {
        var email = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (email.Length is 0 or > MaxLength || email.Any(char.IsWhiteSpace))
        {
            return null;
        }

        return MailAddress.TryCreate(email, out var parsed) && parsed.Address == email && email.Contains('.', StringComparison.Ordinal)
            ? email
            : null;
    }
}
