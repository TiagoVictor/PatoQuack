namespace PatoQuack.Domain.Servers;

/// <summary>
/// Participação de um usuário num servidor (o dono também é membro). Quando houver roles, é
/// aqui que elas se penduram (ex.: coleção de RoleIds); as permissões continuam vindo de
/// <see cref="ServerPermissions.For"/>.
/// </summary>
public sealed class ServerMember
{
    // Usado pelo EF Core para materializar a entidade.
    private ServerMember()
    {
    }

    public ServerMember(Guid serverId, Guid userId, DateTimeOffset joinedAt)
    {
        ServerId = serverId;
        UserId = userId;
        JoinedAt = joinedAt;
    }

    public Guid ServerId { get; private set; }

    public Guid UserId { get; private set; }

    public DateTimeOffset JoinedAt { get; private set; }
}
