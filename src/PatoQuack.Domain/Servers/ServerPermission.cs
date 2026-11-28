namespace PatoQuack.Domain.Servers;

/// <summary>
/// O que um usuário pode fazer num servidor. Os casos de uso checam permissões, nunca "é dono?"
/// diretamente: assim, roles futuras só mudam como as permissões são calculadas.
/// </summary>
[Flags]
public enum ServerPermission
{
    None = 0,
    ViewChannels = 1 << 0,
    ConnectVoice = 1 << 1,
    ManageChannels = 1 << 2,
    ManageServer = 1 << 3,
    /// <summary>Criar, ver e revogar convites.</summary>
    ManageInvites = 1 << 4,
    DeleteServer = 1 << 5,
    SendMessages = 1 << 6,
    ViewMembers = 1 << 7,

    All = ViewChannels | ConnectVoice | ManageChannels | ManageServer | ManageInvites | DeleteServer | SendMessages | ViewMembers,
}

public static class ServerPermissions
{
    /// <summary>O que todo membro pode fazer.</summary>
    public const ServerPermission Member =
        ServerPermission.ViewChannels | ServerPermission.ConnectVoice | ServerPermission.SendMessages | ServerPermission.ViewMembers;

    /// <summary>
    /// Permissões efetivas do usuário no servidor. Hoje: dono = tudo; membro = <see cref="Member"/>;
    /// quem não é membro = nada. Com roles, some aqui as permissões das roles do membro.
    /// </summary>
    public static ServerPermission For(Server server, Guid userId, bool isMember) =>
        server.IsOwner(userId) ? ServerPermission.All
        : isMember ? Member
        : ServerPermission.None;
}
