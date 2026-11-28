using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PatoQuack.Domain.Common;
using PatoQuack.Domain.Servers;
using PatoQuack.Domain.Users;

namespace PatoQuack.Infrastructure.Persistence.Servers;

internal sealed class ServerConfiguration : IEntityTypeConfiguration<Server>
{
    public const string Table = "servers";

    public void Configure(EntityTypeBuilder<Server> builder)
    {
        builder.ToTable(Table);

        builder.HasKey(s => s.Id);

        builder.Property(s => s.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(s => s.Name)
            .HasColumnName("name")
            .HasMaxLength(DisplayName.MaxLength)
            .IsRequired();

        builder.Property(s => s.CreatedAt)
            .HasColumnName("created_at")
            .IsRequired();

        builder.Property(s => s.OwnerId)
            .HasColumnName("owner_id")
            .IsRequired();

        builder.HasIndex(s => s.OwnerId);

        // Não dá para apagar um usuário que ainda é dono de servidores.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(s => s.OwnerId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
