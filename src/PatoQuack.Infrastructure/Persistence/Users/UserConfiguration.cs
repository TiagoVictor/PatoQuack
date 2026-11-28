using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PatoQuack.Domain.Common;
using PatoQuack.Domain.Users;

namespace PatoQuack.Infrastructure.Persistence.Users;

internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public const string Table = "users";

    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable(Table);

        builder.HasKey(u => u.Id);

        builder.Property(u => u.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(u => u.Name)
            .HasColumnName("name")
            .HasMaxLength(DisplayName.MaxLength)
            .IsRequired();

        // E-mail e usuário já chegam normalizados (minúsculas) do domínio.
        builder.Property(u => u.Email)
            .HasColumnName("email")
            .HasMaxLength(EmailAddress.MaxLength)
            .IsRequired();

        builder.Property(u => u.Username)
            .HasColumnName("username")
            .HasMaxLength(Username.MaxLength)
            .IsRequired();

        builder.Property(u => u.PasswordHash)
            .HasColumnName("password_hash")
            .HasMaxLength(512)
            .IsRequired();

        builder.Property(u => u.CreatedAt)
            .HasColumnName("created_at")
            .IsRequired();

        builder.Property(u => u.FailedLoginCount)
            .HasColumnName("failed_login_count")
            .IsRequired();

        builder.Property(u => u.LockoutEndsAt)
            .HasColumnName("lockout_ends_at");

        builder.HasIndex(u => u.Email).IsUnique();
        builder.HasIndex(u => u.Username).IsUnique();
    }
}
