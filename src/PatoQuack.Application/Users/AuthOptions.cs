namespace PatoQuack.Application.Users;

/// <summary>Regras de login (seção "Auth").</summary>
public sealed class AuthOptions
{
    public const string SectionName = "Auth";

    /// <summary>Senhas erradas seguidas até bloquear a conta.</summary>
    public int MaxFailedLogins { get; set; } = 5;

    /// <summary>Por quanto tempo o login fica bloqueado.</summary>
    public int LockoutMinutes { get; set; } = 15;

    /// <summary>Tentativas por minuto, por IP, nas rotas de conta e convite (aplicado no adaptador HTTP).</summary>
    public int RateLimitPerMinute { get; set; } = 20;
}
