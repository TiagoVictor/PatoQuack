namespace PatoQuack.Server.Email;

/// <summary>Seção "Email" do appsettings.json.</summary>
public sealed class EmailOptions
{
    public const string SectionName = "Email";

    /// <summary>"Pickup" (grava os e-mails numa pasta; desenvolvimento) ou "Smtp" (envia de verdade).</summary>
    public string Mode { get; set; } = "Pickup";

    /// <summary>Pasta do modo Pickup (relativa à pasta do app).</summary>
    public string PickupDirectory { get; set; } = "storage/mail";

    public string From { get; set; } = "PatoQuack <no-reply@localhost>";

    // SMTP (provedor escolhido na hora de subir na VPS). Senha: use variável de ambiente
    // (Email__Password), não o appsettings.json.
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 587;
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

/// <summary>Seção "App": endereço público usado nos links dos e-mails.</summary>
public sealed class AppOptions
{
    public const string SectionName = "App";

    /// <summary>
    /// Ex.: https://patoquack.seudominio.com. Obrigatório fora do desenvolvimento: montar o link a
    /// partir do Host da requisição deixaria um atacante apontar o link de redefinição de senha
    /// para o site dele (e roubar o token).
    /// </summary>
    public string PublicUrl { get; set; } = string.Empty;
}
