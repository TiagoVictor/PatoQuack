namespace PatoQuack.Application.Voice;

public sealed class VoiceOptions
{
    public const string SectionName = "Voice";

    /// <summary>
    /// Limite de participantes por canal. Em malha P2P cada pessoa envia o áudio para todas as
    /// outras; 8 ainda é viável porque o vídeo só vai para quem assiste (WatchStream).
    /// </summary>
    public int MaxParticipantsPerChannel { get; set; } = 8;
}
