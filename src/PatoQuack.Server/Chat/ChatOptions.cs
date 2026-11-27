namespace PatoQuack.Server.Chat;

/// <summary>Configuração do chat de texto (seção "Chat" do appsettings.json).</summary>
public sealed class ChatOptions
{
    public const string SectionName = "Chat";

    /// <summary>Arquivo SQLite. Caminho relativo = relativo à pasta do app (ContentRoot).</summary>
    public string DatabasePath { get; set; } = "data/patoquack.db";

    /// <summary>
    /// Mensagens mais antigas que isto são apagadas. Sem login, quem souber o nome da sala lê o
    /// histórico guardado: a retenção limita essa exposição. 0 = guardar para sempre.
    /// </summary>
    public int RetentionDays { get; set; } = 30;

    /// <summary>Quantas mensagens o histórico devolve por página.</summary>
    public int HistoryPageSize { get; set; } = 50;

    public int MaxMessageLength { get; set; } = 2000;

    /// <summary>No máximo <see cref="RateLimitCount"/> mensagens a cada <see cref="RateLimitWindowSeconds"/> s por conexão.</summary>
    public int RateLimitCount { get; set; } = 5;

    public int RateLimitWindowSeconds { get; set; } = 5;
}
