import { useEffect, useRef, useState } from "react";
import dynamic from 'next/dynamic';

const SIGNALING_URL = "wss://accent-method-residence-elect.trycloudflare.com";

export default function RoomPage({ roomId }) {
  const localVideo = useRef(null);
  const [streams, setStreams] = useState([null, null, null]); // max 3
  const [chat, setChat] = useState([]);
  const [message, setMessage] = useState("");
  const wsRef = useRef(null);

  useEffect(() => {
    let localStream;
    let peers = {}; // userId: RTCPeerConnection

    async function init() {
      localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
      setStreams(s => [localStream, null, null]);
      if (localVideo.current) localVideo.current.srcObject = localStream;

      const ws = new window.WebSocket(SIGNALING_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ action: "join_room", roomId }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.action === "peers") {
          // اگر نفر جدید اضافه شد/حذف/...
          // ساخت peer connection ساده (نیاز به تکمیل logic)
        }
        if (msg.action === "signal") {
          // مدیریت پیغام های سیگنالینگ WebRTC
        }
        if (msg.action === "chat") {
          setChat(old => [...old, { from: msg.from, text: msg.text }]);
        }
        if (msg.action === "force_leave") {
          alert("اتاق پر است");
          window.location = "/";
        }
      };
    }

    init();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
    }
  }, [roomId]);

  return (
    <div style={{display: "flex", height: "100vh"}}>
      <div style={{flex: 1}}>
        {/* باکس تصویر کاربران */}
        <video ref={localVideo} autoPlay muted style={{width: "100%", maxWidth: 300, border: "2px solid green"}} />
        {/* دو ویدئوی دیگر */}
        {/* streams[1] و streams[2] */}
      </div>
      <div style={{flex: 1, background: "#eee"}}>
        <h3>چت متنی</h3>
        <div style={{height: 400, overflowY: "auto"}}>
          {chat.map((c, i) => <div key={i}><b>{c.from}: </b>{c.text}</div>)}
        </div>
        <input value={message} onChange={e=>setMessage(e.target.value)} />
        <button onClick={() => {
          if (wsRef.current && message) {
            wsRef.current.send(JSON.stringify({ action: "chat", text: message }));
            setMessage("");
          }
        }}>ارسال</button>
      </div>
    </div>
  )
}

// برای گرفتن roomId از url:
RoomPage.getInitialProps = async ({ query }) => ({ roomId: query.roomId });