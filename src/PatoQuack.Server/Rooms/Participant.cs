namespace PatoQuack.Server.Rooms;

/// <summary>Um participante conectado a uma sala de voz.</summary>
/// <param name="ConnectionId">Id da conexão SignalR (identifica o peer na sinalização).</param>
/// <param name="Name">Nome de exibição.</param>
/// <param name="Room">Nome normalizado da sala.</param>
/// <param name="Muted">Se o participante está com o microfone mutado.</param>
public sealed record Participant(string ConnectionId, string Name, string Room, bool Muted = false);
