namespace PatoQuack.Application.Servers;

public sealed class ServerOptions
{
    public const string SectionName = "Servers";

    /// <summary>Limite de canais por servidor (sem login, qualquer um com o convite pode criar).</summary>
    public int MaxChannelsPerServer { get; set; } = 50;

    /// <summary>Nome do canal criado junto com o servidor.</summary>
    public string DefaultChannelName { get; set; } = "geral";

    /// <summary>Validade (dias) do convite criado com o servidor e do convite sem opções.</summary>
    public int DefaultInviteDays { get; set; } = 7;

    /// <summary>Limite de usos do convite padrão.</summary>
    public int DefaultInviteMaxUses { get; set; } = 10;
}
