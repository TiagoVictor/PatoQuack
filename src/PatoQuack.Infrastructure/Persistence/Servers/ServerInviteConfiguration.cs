using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PatoQuack.Domain.Servers;
using PatoQuack.Domain.Users;

namespace PatoQuack.Infrastructure.Persistence.Servers;

internal sealed class ServerInviteConfiguration : IEntityTypeConfiguration<ServerInvite>
{
    public const string Table = "server_invites";

    public void Configure(EntityTypeBuilder<ServerInvite> builder)
    {
        builder.ToTable(Table);

        builder.HasKey(i => i.Id);

        builder.Property(i => i.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(i => i.ServerId).HasColumnName("server_id").IsRequired();

        builder.Property(i => i.Code)
            .HasColumnName("code")
            .HasMaxLength(InviteCode.Length)
            .IsRequired();

        builder.Property(i => i.CreatedById).HasColumnName("created_by_id").IsRequired();
        builder.Property(i => i.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(i => i.ExpiresAt).HasColumnName("expires_at");
        builder.Property(i => i.MaxUses).HasColumnName("max_uses");
        builder.Property(i => i.Uses).HasColumnName("uses").IsRequired();
        builder.Property(i => i.RevokedAt).HasColumnName("revoked_at");

        builder.HasIndex(i => i.Code).IsUnique();
        builder.HasIndex(i => i.ServerId);

        // Apagar o servidor apaga os convites dele.
        builder.HasOne<Server>()
            .WithMany()
            .HasForeignKey(i => i.ServerId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(i => i.CreatedById)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
