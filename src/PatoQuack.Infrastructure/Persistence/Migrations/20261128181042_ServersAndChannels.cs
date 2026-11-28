using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PatoQuack.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ServersAndChannels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // participants é só presença (some ao reiniciar). Limpar antes de trocar a sala
            // pelo canal evita violar a FK nova com linhas antigas.
            migrationBuilder.Sql("DELETE FROM participants;");

            migrationBuilder.DropForeignKey(
                name: "FK_participants_rooms_room_name",
                table: "participants");

            migrationBuilder.DropTable(
                name: "rooms");

            migrationBuilder.DropIndex(
                name: "IX_participants_room_name_joined_at",
                table: "participants");

            migrationBuilder.DropColumn(
                name: "room_name",
                table: "participants");

            migrationBuilder.AddColumn<Guid>(
                name: "channel_id",
                table: "participants",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateTable(
                name: "servers",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    invite_code = table.Column<string>(type: "character(8)", fixedLength: true, maxLength: 8, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_servers", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "voice_channels",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    server_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    streamer_connection_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_voice_channels", x => x.id);
                    table.ForeignKey(
                        name: "FK_voice_channels_servers_server_id",
                        column: x => x.server_id,
                        principalTable: "servers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_participants_channel_id_joined_at",
                table: "participants",
                columns: new[] { "channel_id", "joined_at" });

            migrationBuilder.CreateIndex(
                name: "IX_servers_invite_code",
                table: "servers",
                column: "invite_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_voice_channels_server_id_name",
                table: "voice_channels",
                columns: new[] { "server_id", "name" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_participants_voice_channels_channel_id",
                table: "participants",
                column: "channel_id",
                principalTable: "voice_channels",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DELETE FROM participants;");

            migrationBuilder.DropForeignKey(
                name: "FK_participants_voice_channels_channel_id",
                table: "participants");

            migrationBuilder.DropTable(
                name: "voice_channels");

            migrationBuilder.DropTable(
                name: "servers");

            migrationBuilder.DropIndex(
                name: "IX_participants_channel_id_joined_at",
                table: "participants");

            migrationBuilder.DropColumn(
                name: "channel_id",
                table: "participants");

            migrationBuilder.AddColumn<string>(
                name: "room_name",
                table: "participants",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "rooms",
                columns: table => new
                {
                    name = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    streamer_connection_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_rooms", x => x.name);
                });

            migrationBuilder.CreateIndex(
                name: "IX_participants_room_name_joined_at",
                table: "participants",
                columns: new[] { "room_name", "joined_at" });

            migrationBuilder.AddForeignKey(
                name: "FK_participants_rooms_room_name",
                table: "participants",
                column: "room_name",
                principalTable: "rooms",
                principalColumn: "name",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
