namespace PatoQuack.Domain.Users;

/// <summary>Nome de usuário (@handle): 3 a 32 caracteres, letras minúsculas, números, "_" e ".".</summary>
public static class Username
{
    public const int MinLength = 3;
    public const int MaxLength = 32;

    public static string? Normalize(string? value)
    {
        var username = (value ?? string.Empty).Trim().TrimStart('@').ToLowerInvariant();
        return username.Length >= MinLength && username.Length <= MaxLength
               && username.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '_' or '.')
            ? username
            : null;
    }
}
