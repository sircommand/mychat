import { useEffect, useRef, useState } from "react";

const SIGNALING_URL = "wss://representative-katie-evaluate-scores.trycloudflare.com";

export default function RoomPage({ roomId }) {
  const localVideo = useRef(null);
  const remoteVideoRefs = [useRef(null), useRef(null)];
  const [streams, setStreams] = useState([null, null, null]);
  const [chat, setChat] = useState([]);
  const [message, setMessage] = useState("");
  const wsRef = useRef(null);
  const userIdRef = useRef(null);
  const peersInfo = useRef({});

  // Utility: allocate a slot for remotes (index: 1 or 2)
  function findEmptyRemoteIndex() {
    let used = Object.values(peersInfo.current).map((info) => info.streamIndex).filter(Boolean);
    for (let i = 1; i <= 2; i++) {
      if (!used.includes(i)) return i;
    }
    return null;
  }

  function setRemoteStream(peerId, stream) {
    setStreams((prev) => {
      const idx = peersInfo.current[peerId].streamIndex;
      const arr = [...prev];
      arr[idx] = stream;
      return arr;
    });
  }

  useEffect(() => {
    let localStream;

    async function init() {
      // 1. getUserMedia
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStreams((s) => [localStream, null, null]);
      if (localVideo.current) localVideo.current.srcObject = localStream;

      // 2. WebSocket
      const ws = new window.WebSocket(SIGNALING_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ action: "join_room", roomId }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        // دریافت userId
        if (msg.action === "your_id") {
          userIdRef.current = msg.userId;
          return;
        }

        // لیست peers حاضر (بدون خودمان!)
        if (msg.action === "peers") {
          if (!userIdRef.current) return;
          // حذف peers جداشده
          Object.keys(peersInfo.current).forEach((pid) => {
            if (!msg.peers.includes(pid)) {
              if (peersInfo.current[pid].pc) peersInfo.current[pid].pc.close();
              setStreams((prev) => {
                const newArr = [...prev];
                newArr[peersInfo.current[pid].streamIndex] = null;
                return newArr;
              });
              delete peersInfo.current[pid];
            }
          });
          // ایجاد connection و فقط یک offer از کسی که userId بزرگتر دارد
          msg.peers.forEach((peerId) => {
            if (peerId === userIdRef.current) return;
            if (!peersInfo.current[peerId]) {
              // نخست اندیس خالی
              const idx = findEmptyRemoteIndex();
              // ایجاد connection
              const pc = new RTCPeerConnection();
              peersInfo.current[peerId] = { pc, streamIndex: idx };
              // ارسال لوکال ترک
              localStream.getTracks().forEach((trk) => pc.addTrack(trk, localStream));
              // دریافت stream مقابل
              pc.ontrack = (ev) => {
                // همواره stream جدید بالاخره attach می‌شود
                setRemoteStream(peerId, ev.streams[0]);
                if (remoteVideoRefs[idx - 1].current) remoteVideoRefs[idx - 1].current.srcObject = ev.streams[0];
              };
              // dispatch candidates
              pc.onicecandidate = (ev) => {
                if (ev.candidate) {
                  ws.send(JSON.stringify({
                    action: "signal",
                    target: peerId,
                    from: userIdRef.current,
                    type: "candidate",
                    candidate: ev.candidate,
                  }));
                }
              };
              // فقط یک نفر offer بفرستد: بزرگتر
              if (userIdRef.current > peerId) {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                ws.send(JSON.stringify({
                  action: "signal",
                  target: peerId,
                  from: userIdRef.current,
                  type: "offer",
                  sdp: offer,
                }));
              }
            }
          });
        } 
        
        // دریافت و پردازش سیگنال ها
        if (msg.action === "signal") {
          const peerId = msg.from;
          if (peerId === userIdRef.current) return;
          // اگر قبلا connection نساخته بودیم
          if (!peersInfo.current[peerId]) {
            const idx = findEmptyRemoteIndex();
            const pc = new RTCPeerConnection();
            peersInfo.current[peerId] = { pc, streamIndex: idx };
            localStream.getTracks().forEach((trk) => pc.addTrack(trk, localStream));
            pc.ontrack = (ev) => {
              setRemoteStream(peerId, ev.streams[0]);
              if (remoteVideoRefs[idx - 1].current) remoteVideoRefs[idx - 1].current.srcObject = ev.streams[0];
            };
            pc.onicecandidate = (ev) => {
              if (ev.candidate) {
                ws.send(JSON.stringify({
                  action: "signal",
                  target: peerId,
                  from: userIdRef.current,
                  type: "candidate",
                  candidate: ev.candidate,
                }));
              }
            };
          }
          const pc = peersInfo.current[peerId].pc;
          // پردازش هر نوع سیگنال
          if (msg.type === "offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({
              action: "signal",
              target: peerId,
              from: userIdRef.current,
              type: "answer",
              sdp: answer,
            }));
          } else if (msg.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          } else if (msg.type === "candidate" && msg.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (e) {}
          }
        }

        if (msg.action === "force_leave") {
          alert("اتاق پر است");
          window.location = "/";
        }
        if (msg.action === "chat") {
          setChat((old) => [...old, { from: msg.from, text: msg.text }]);
        }
      };
    }

    init();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      Object.values(peersInfo.current).forEach((o) => o.pc && o.pc.close());
    };
    // eslint-disable-next-line
  }, [roomId]);

  useEffect(() => {
    for (let i = 1; i <= 2; ++i) {
      if (streams[i] && remoteVideoRefs[i - 1].current)
        remoteVideoRefs[i - 1].current.srcObject = streams[i];
    }
  }, [streams]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <video ref={localVideo} autoPlay muted playsInline style={{ width: "100%", maxWidth: 320, border: "2px solid green", margin: "10px" }} />
        <video ref={remoteVideoRefs[0]} autoPlay playsInline style={{ width: "100%", maxWidth: 320, border: "2px solid red", margin: "10px" }} />
        <video ref={remoteVideoRefs[1]} autoPlay playsInline style={{ width: "100%", maxWidth: 320, border: "2px solid blue", margin: "10px" }} />
      </div>
      <div style={{ flex: 1, background: "#eee", display: 'flex', flexDirection: "column" }}>
        <h3>چت متنی</h3>
        <div style={{ height: 400, overflowY: "auto", flex: 1 }}>
          {chat.map((c, i) => <div key={i}><b>{c.from}: </b>{c.text}</div>)}
        </div>
        <div style={{ display: "flex" }}>
          <input value={message} onChange={e => setMessage(e.target.value)} style={{ flex: 1 }} />
          <button onClick={() => {
            if (wsRef.current && message) {
              wsRef.current.send(JSON.stringify({ action: "chat", text: message, from: userIdRef.current }));
              setMessage("");
            }
          }}>ارسال</button>
        </div>
      </div>
    </div>
  );
}

RoomPage.getInitialProps = async ({ query }) => ({ roomId: query.roomId });