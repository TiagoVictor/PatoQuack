using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace PatoQuack.Server.Data;

/// <summary>Conta de usuário (Identity). O e-mail é o login; DisplayName é o nome exibido na sala.</summary>
public sealed class AppUser : IdentityUser
{
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Administrador do PatoQuack (a conta criada no primeiro acesso).</summary>
    public bool IsAdmin { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Servidor (como no Discord): tem dono, membros, canais e convites.</summary>
public sealed class Server
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string OwnerId { get; set; } = string.Empty;
    public AppUser? Owner { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public List<ServerMember> Members { get; set; } = [];
    public List<Channel> Channels { get; set; } = [];
}

public enum ServerRole
{
    Member = 0,
    Owner = 2,
}

public sealed class ServerMember
{
    public int ServerId { get; set; }
    public Server? Server { get; set; }
    public string UserId { get; set; } = string.Empty;
    public AppUser? User { get; set; }
    public ServerRole Role { get; set; }
    public DateTimeOffset JoinedAt { get; set; }
}

public enum ChannelKind
{
    Voice = 0,
    Text = 1,
}

/// <summary>Canal de um servidor. Canal de voz = sala da chamada (com chat próprio).</summary>
public sealed class Channel
{
    public int Id { get; set; }
    public int ServerId { get; set; }
    public Server? Server { get; set; }
    public string Name { get; set; } = string.Empty;
    public ChannelKind Kind { get; set; }
    public int Position { get; set; }
}

/// <summary>
/// Convite de servidor: serve para entrar no servidor e, para quem não tem conta, para se
/// cadastrar (o cadastro é só por convite). Vale até ExpiresAt e, se MaxUses, até esse número de usos.
/// </summary>
public sealed class ServerInvite
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public int ServerId { get; set; }
    public Server? Server { get; set; }
    public string CreatedById { get; set; } = string.Empty;
    public AppUser? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public int? MaxUses { get; set; }
    public int Uses { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}

/// <summary>Mensagem do chat de um canal.</summary>
public sealed class ChatMessage
{
    public long Id { get; set; }
    public int ChannelId { get; set; }
    public Channel? Channel { get; set; }
    public string AuthorName { get; set; } = string.Empty;
    public string? AuthorId { get; set; }
    public string Text { get; set; } = string.Empty;
    public DateTimeOffset SentAt { get; set; }
}

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<Server> Servers => Set<Server>();
    public DbSet<ServerMember> ServerMembers => Set<ServerMember>();
    public DbSet<Channel> Channels => Set<Channel>();
    public DbSet<ServerInvite> ServerInvites => Set<ServerInvite>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        // O SQLite não compara nem ordena DateTimeOffset nas consultas: guardamos como número
        // (conversor oficial do EF), o que permite filtrar por data (retenção, validade).
        builder.Properties<DateTimeOffset>().HaveConversion<DateTimeOffsetToBinaryConverter>();
    }

    protected override void OnModelCreating(ModelBuilder model)
    {
        base.OnModelCreating(model);

        model.Entity<AppUser>(e => e.Property(u => u.DisplayName).HasMaxLength(32).IsRequired());

        model.Entity<Server>(e =>
        {
            e.Property(s => s.Name).HasMaxLength(40).IsRequired();
            e.HasOne(s => s.Owner).WithMany().HasForeignKey(s => s.OwnerId).OnDelete(DeleteBehavior.Restrict);
        });

        model.Entity<ServerMember>(e =>
        {
            e.HasKey(m => new { m.ServerId, m.UserId });
            e.HasIndex(m => m.UserId);
            e.HasOne(m => m.Server).WithMany(s => s.Members).HasForeignKey(m => m.ServerId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<Channel>(e =>
        {
            e.Property(c => c.Name).HasMaxLength(32).IsRequired();
            e.HasOne(c => c.Server).WithMany(s => s.Channels).HasForeignKey(c => c.ServerId).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<ServerInvite>(e =>
        {
            e.HasIndex(i => i.Code).IsUnique();
            e.Property(i => i.Code).HasMaxLength(32).IsRequired();
            e.HasOne(i => i.Server).WithMany().HasForeignKey(i => i.ServerId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(i => i.CreatedBy).WithMany().HasForeignKey(i => i.CreatedById).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<ChatMessage>(e =>
        {
            e.HasIndex(m => new { m.ChannelId, m.Id });
            e.HasIndex(m => m.SentAt);
            e.HasOne(m => m.Channel).WithMany().HasForeignKey(m => m.ChannelId).OnDelete(DeleteBehavior.Cascade);
            e.Property(m => m.AuthorName).HasMaxLength(32).IsRequired();
            e.Property(m => m.Text).HasMaxLength(2000).IsRequired();
        });
    }
}
