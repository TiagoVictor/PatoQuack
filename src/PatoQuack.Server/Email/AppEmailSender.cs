using System.Text.Json;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace PatoQuack.Server.Email;

/// <summary>Um e-mail transacional (confirmação de conta, redefinição de senha).</summary>
/// <param name="Link">O link principal (gravado à parte no modo Pickup, para testes e desenvolvimento).</param>
public sealed record AppEmail(string To, string Subject, string Text, string Link);

public interface IAppEmailSender
{
    Task SendAsync(AppEmail email, CancellationToken cancellationToken = default);
}

/// <summary>Desenvolvimento: grava cada e-mail como JSON numa pasta, em vez de enviar.</summary>
public sealed class PickupEmailSender(IOptions<EmailOptions> options, IHostEnvironment env, ILogger<PickupEmailSender> logger) : IAppEmailSender
{
    public async Task SendAsync(AppEmail email, CancellationToken cancellationToken = default)
    {
        var dir = options.Value.PickupDirectory;
        dir = Path.IsPathRooted(dir) ? dir : Path.Combine(env.ContentRootPath, dir);
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, $"{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(file, JsonSerializer.Serialize(email), cancellationToken);
        logger.LogInformation("E-mail para {To} gravado em {File} (modo Pickup). Link: {Link}", email.To, file, email.Link);
    }
}

/// <summary>Produção: envia por SMTP (MailKit) com STARTTLS/SSL conforme a porta.</summary>
public sealed class SmtpEmailSender(IOptions<EmailOptions> options) : IAppEmailSender
{
    public async Task SendAsync(AppEmail email, CancellationToken cancellationToken = default)
    {
        var o = options.Value;
        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(o.From));
        message.To.Add(MailboxAddress.Parse(email.To));
        message.Subject = email.Subject;
        message.Body = new TextPart("plain") { Text = email.Text };

        using var client = new SmtpClient();
        await client.ConnectAsync(o.Host, o.Port, SecureSocketOptions.Auto, cancellationToken);
        if (!string.IsNullOrEmpty(o.Username))
        {
            await client.AuthenticateAsync(o.Username, o.Password, cancellationToken);
        }

        await client.SendAsync(new SendRequest(message), cancellationToken); // API do MailKit 5
        await client.DisconnectAsync(true, cancellationToken);
    }
}
