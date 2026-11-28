namespace PatoQuack.Domain.Servers;

/// <summary>Membro como aparece na lista do servidor.</summary>
public sealed record ServerMemberView(Guid UserId, string Name, string Username, bool IsOwner, DateTimeOffset JoinedAt);
