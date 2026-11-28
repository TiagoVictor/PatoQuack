namespace PatoQuack.Domain.Servers;

/// <summary>
/// Convite para um servidor: vale até <see cref="ExpiresAt"/> (null = sem validade) e para até
/// <see cref="MaxUses"/> pessoas (null = sem limite). Pode ser revogado. Quem já é membro e abre
/// o convite não gasta um uso.
/// </summary>
public sealed class ServerInvite
{
    // Usado pelo EF Core para materializar a entidade.
    private ServerInvite()
    {
        Code = string.Empty;
    }

    public ServerInvite(Guid id, Guid serverId, string code, Guid createdById, DateTimeOffset createdAt, DateTimeOffset? expiresAt, int? maxUses)
    {
        Code = InviteCode.Normalize(code) ?? throw new ArgumentException("Código de convite inválido.", nameof(code));
        if (maxUses is <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxUses), "O limite de usos precisa ser positivo.");
        }

        Id = id;
        ServerId = serverId;
        CreatedById = createdById;
        CreatedAt = createdAt;
        ExpiresAt = expiresAt;
        MaxUses = maxUses;
    }

    public Guid Id { get; private set; }

    public Guid ServerId { get; private set; }

    public string Code { get; private set; }

    public Guid CreatedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? ExpiresAt { get; private set; }

    public int? MaxUses { get; private set; }

    /// <summary>Quantas pessoas entraram por ele.</summary>
    public int Uses { get; private set; }

    public DateTimeOffset? RevokedAt { get; private set; }

    /// <summary>Ainda leva alguém para dentro: não revogado, não vencido e com usos sobrando.</summary>
    public bool IsUsable(DateTimeOffset now) =>
        RevokedAt is null && (ExpiresAt is null || ExpiresAt > now) && (MaxUses is null || Uses < MaxUses);

    public void Revoke(DateTimeOffset now) => RevokedAt ??= now;
}
