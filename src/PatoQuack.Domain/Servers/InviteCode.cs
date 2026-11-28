using System.Security.Cryptography;

namespace PatoQuack.Domain.Servers;

/// <summary>
/// Código de convite: minúsculas e números sem os ambíguos (0/o, 1/l/i). Os novos têm 12 caracteres
/// (31^12 ≈ 8×10^17 combinações, e as rotas de convite têm limite por IP); os de 8 caracteres
/// são os convites criados antes da validade/limite de usos e continuam valendo.
/// </summary>
public static class InviteCode
{
    public const int Length = 12;
    public const int LegacyLength = 8;
    private const string Alphabet = "abcdefghjkmnpqrstuvwxyz23456789";

    public static string New() => RandomNumberGenerator.GetString(Alphabet, Length);

    /// <summary>Normaliza o que a pessoa digitou (aceita maiúsculas). Null se não for um código válido.</summary>
    public static string? Normalize(string? value)
    {
        var code = (value ?? string.Empty).Trim().ToLowerInvariant();
        return code.Length is Length or LegacyLength && code.All(Alphabet.Contains) ? code : null;
    }
}
