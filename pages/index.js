import { useState } from "react";

export default function Home() {
  const [roomLink, setRoomLink] = useState(null);

  function createRoom() {
    fetch("/api/create-room")
      .then(res => res.json())
      .then(data => setRoomLink(window.location.origin + "/room/" + data.roomId));
  }

  return (
    <div style={{textAlign: "center", marginTop: "100px"}}>
      <h1>ویدیو چت سه نفره</h1>
      <button onClick={createRoom}>ایجاد اتاق جدید</button>
      {roomLink && <div style={{marginTop: "20px"}}><a href={roomLink}>{roomLink}</a></div>}
    </div>
  );
}