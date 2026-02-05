// این کد assume میکنه back sig server url رو میدونی و اون رول رو داری
export default async function handler(req, res) {
  const ws = new (require("ws"))("wss://accent-method-residence-elect.trycloudflare.com");
  await new Promise((resolve) => ws.on('open', resolve));
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.action === "room_created") {
      ws.close();
      res.status(200).json({ roomId: data.roomId });
    }
  };
  ws.send(JSON.stringify({ action: "create_room" }));
}