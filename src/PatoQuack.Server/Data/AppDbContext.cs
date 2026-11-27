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

/// <summary>
/// Convite de cadastro: um link de uso único, com validade. Sem convite não se cria conta
/// (exceto o administrador, no primeiro acesso). Room = sala sugerida depois de entrar.
/// </summary>
public sealed class SignupInvite
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string CreatedById { get; set; } = string.Empty;
    public AppUser? CreatedBy { get; set; }
    public string? Room { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public string? UsedById { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
}

/// <summary>Mensagem do chat de uma sala.</summary>
public sealed class ChatMessage
{
    public long Id { get; set; }
    public string Room { get; set; } = string.Empty;
    public string AuthorName { get; set; } = string.Empty;
    public string? AuthorId { get; set; }
    public string Text { get; set; } = string.Empty;
    public DateTimeOffset SentAt { get; set; }
}

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<SignupInvite> SignupInvites => Set<SignupInvite>();
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

        model.Entity<SignupInvite>(e =>
        {
            e.HasIndex(i => i.Code).IsUnique();
            e.Property(i => i.Code).HasMaxLength(32).IsRequired();
            e.Property(i => i.Room).HasMaxLength(32);
            e.HasOne(i => i.CreatedBy).WithMany().HasForeignKey(i => i.CreatedById).OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<ChatMessage>(e =>
        {
            e.HasIndex(m => new { m.Room, m.Id });
            e.HasIndex(m => m.SentAt);
            e.Property(m => m.Room).HasMaxLength(32).IsRequired();
            e.Property(m => m.AuthorName).HasMaxLength(32).IsRequired();
            e.Property(m => m.Text).HasMaxLength(2000).IsRequired();
        });
    }
}
