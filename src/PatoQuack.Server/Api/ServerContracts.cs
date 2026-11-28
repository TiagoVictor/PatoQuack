namespace PatoQuack.Server.Api;

public sealed record NameRequest(string? Name);

public sealed record ChannelDto(Guid Id, string Name);

/// <summary>Servidor na lista "meus servidores".</summary>
public sealed record ServerSummaryDto(Guid Id, string Name, bool IsOwner);

/// <summary>
/// Servidor aberto. <c>Permissions</c> lista o que o usuário pode fazer (nomes em camelCase de
/// ServerPermission), para o front mostrar ou esconder ações.
/// </summary>
public sealed record ServerDto(
    Guid Id,
    string Name,
    bool IsOwner,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<ChannelDto> Channels);

/// <summary>Opções de um convite novo: validade 1, 7 ou 30 dias; usos 1, 10 ou null (sem limite). Sem nenhum: 7 dias, 10 pessoas.</summary>
public sealed record CreateInviteRequest(int? ExpiresInDays, int? MaxUses);

/// <summary>Convite como o dono o vê (o link é montado pelo front: /convite/{Code}).</summary>
public sealed record ServerInviteDto(string Code, DateTimeOffset CreatedAt, DateTimeOffset? ExpiresAt, int? MaxUses, int Uses);

public sealed record MemberDto(Guid UserId, string Name, string Username, bool IsOwner);

public sealed record InviteDto(Guid ServerId, string ServerName, bool AlreadyMember);

public sealed record AcceptInviteDto(Guid ServerId);
