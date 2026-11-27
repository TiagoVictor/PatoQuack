using Microsoft.Extensions.Options;

namespace PatoQuack.Server.Chat;

/// <summary>Apaga mensagens mais antigas que a retenção configurada: ao iniciar e a cada hora.</summary>
public sealed class ChatRetentionService(
    IChatStore store,
    IOptions<ChatOptions> options,
    TimeProvider time,
    ILogger<ChatRetentionService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var days = options.Value.RetentionDays;
        if (days <= 0)
        {
            logger.LogInformation("Chat: retenção desligada (mensagens guardadas para sempre).");
            return;
        }

        using var timer = new PeriodicTimer(Interval, time);
        do
        {
            try
            {
                var deleted = await store.DeleteOlderThanAsync(time.GetUtcNow().AddDays(-days));
                if (deleted > 0)
                {
                    logger.LogInformation("Chat: {Count} mensagens com mais de {Days} dias apagadas.", deleted, days);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Chat: falha ao apagar mensagens antigas.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
