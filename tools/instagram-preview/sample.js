export default {
  "version": 1,
  "owner": "demo_business",
  "source": "manual",
  "capturedAt": "2026-10-30T12:00:00Z",
  "rangeStart": "2026-10-01",
  "rangeEnd": "2026-10-30",
  "coverage": "partial",
  "events": [
    {
      "account": "demo_club_a",
      "type": "new_dm",
      "date": "2026-10-02",
      "direction": "outbound",
      "historyStartSeen": true,
      "firstOutboundConfirmed": true,
      "evidence": "history_start",
      "verified": true,
      "reason": "",
      "party": ""
    },
    {
      "account": "demo_club_a",
      "type": "reply",
      "date": "2026-10-03",
      "direction": "inbound",
      "historyStartSeen": false,
      "firstOutboundConfirmed": false,
      "evidence": "received_message",
      "verified": true,
      "reason": "",
      "party": ""
    },
    {
      "account": "demo_club_a",
      "type": "reply",
      "date": "2026-10-04",
      "direction": "inbound",
      "historyStartSeen": false,
      "firstOutboundConfirmed": false,
      "evidence": "received_message",
      "verified": true,
      "reason": "",
      "party": ""
    },
    {
      "account": "demo_club_a",
      "type": "zoom_invite",
      "date": "2026-10-05",
      "direction": "outbound",
      "historyStartSeen": false,
      "firstOutboundConfirmed": false,
      "evidence": "explicit_zoom_invitation",
      "verified": true,
      "reason": "",
      "party": ""
    },
    {
      "account": "demo_club_b",
      "type": "new_dm",
      "date": "2026-10-06",
      "direction": "outbound",
      "historyStartSeen": false,
      "firstOutboundConfirmed": true,
      "evidence": "history_start",
      "verified": true,
      "reason": "history_incomplete",
      "party": ""
    },
    {
      "account": "demo_club_c",
      "type": "zoom_invite",
      "date": "2026-10-09",
      "direction": "outbound",
      "historyStartSeen": false,
      "firstOutboundConfirmed": false,
      "evidence": "ambiguous_zoom",
      "verified": true,
      "reason": "ambiguous_invitation",
      "party": ""
    }
  ]
};
