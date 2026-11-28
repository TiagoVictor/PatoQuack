namespace PatoQuack.Domain.Common;

/// <summary>Regras de nomes exibidos (servidor, canal, participante): 1 a 32 caracteres, sem controle.</summary>
public static class DisplayName
{
    public const int MaxLength = 32;

    /// <summary>Remove espaços nas pontas e valida. Retorna null se o nome for inválido.</summary>
    public static string? Normalize(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.Length is 0 or > MaxLength || trimmed.Any(char.IsControl) ? null : trimmed;
    }
}
