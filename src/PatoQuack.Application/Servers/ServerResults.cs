using PatoQuack.Domain.Channels;
using PatoQuack.Domain.Servers;

namespace PatoQuack.Application.Servers;

/// <summary>Servidor como o usuário o vê: canais (em ordem de criação) e o que ele pode fazer.</summary>
public sealed record ServerDetails(Server Server, IReadOnlyList<VoiceChannel> Channels, ServerPermission Permissions)
{
    public bool Can(ServerPermission permission) => Permissions.HasFlag(permission);
}

/// <summary>Servidor na lista "meus servidores".</summary>
public sealed record ServerSummary(Server Server, ServerPermission Permissions);

/// <summary>O que dá para ver de um convite antes de aceitar.</summary>
public sealed record InvitePreview(Guid ServerId, string ServerName, bool AlreadyMember);

public enum ServerOperationStatus
{
    Succeeded,
    /// <summary>Não existe, ou o usuário não é membro (não revelamos a existência a quem não é).</summary>
    NotFound,
    /// <summary>É membro, mas não tem a permissão necessária.</summary>
    Forbidden,
    InvalidName,
    NameTaken,
    TooManyChannels,
    /// <summary>O dono não pode sair do próprio servidor (só apagá-lo).</summary>
    OwnerCannotLeave,
    /// <summary>Validade ou limite de usos fora das opções permitidas.</summary>
    InvalidInviteOptions,
}

public sealed record ServerOperationResult<T>(ServerOperationStatus Status, T? Value = default)
{
    public bool Succeeded => Status == ServerOperationStatus.Succeeded;

    public static ServerOperationResult<T> Ok(T value) => new(ServerOperationStatus.Succeeded, value);

    public static ServerOperationResult<T> Fail(ServerOperationStatus status) => new(status);
}

/// <summary>Resultado de uma remoção: os canais que deixaram de existir (para avisar quem está neles).</summary>
public sealed record DeletedChannels(IReadOnlyList<Guid> ChannelIds);
