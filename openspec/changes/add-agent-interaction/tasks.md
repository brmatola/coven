# Tasks: Add Agent Interaction

## 1. Output Channel
- [x] 1.1 Create `FamiliarOutputChannel` managing VSCode output channels
- [x] 1.2 Create one output channel per active familiar
- [x] 1.3 Stream agent output to channel in real-time
- [x] 1.4 Add timestamps and formatting to output
- [x] 1.5 Implement output channel cleanup on task completion
- [x] 1.6 Add "View Output" command to reveal channel

## 2. Question Response UI
- [ ] 2.1 Create question response webview panel
- [ ] 2.2 Display question text and context
- [ ] 2.3 Show suggested responses as buttons
- [ ] 2.4 Allow custom text response input
- [ ] 2.5 Implement response submission back to agent
- [ ] 2.6 Handle different question types (clarification, permission, decision, blocked)

## 3. Notifications
- [ ] 3.1 Create notification helper utilities
- [ ] 3.2 Notify when agent completes task (with "Review" action)
- [ ] 3.3 Notify when agent needs response (with "Respond" action)
- [ ] 3.4 Notify when conflict is resolved automatically
- [ ] 3.5 Notify when agent is stuck/blocked (with "Help" action)
- [ ] 3.6 Add notification throttling for rapid events

## 4. Activity Log
- [ ] 4.1 Add activity log section to sidebar
- [ ] 4.2 Log significant events (task started, completed, question, conflict)
- [ ] 4.3 Show timestamps and brief descriptions
- [ ] 4.4 Limit log to recent N entries
- [ ] 4.5 Click log entry to navigate to relevant item

## 5. Integration
- [ ] 5.1 Subscribe to FamiliarManager events for output and questions
- [ ] 5.2 Wire notifications to CovenSession events
- [ ] 5.3 Add keyboard shortcuts for quick response

## 6. E2E Tests
- [ ] 6.1 Test: Output channel created for working task
- [ ] 6.2 Test: Question panel opens when agent asks question
- [ ] 6.3 Test: Responding to question sends response to agent
- [ ] 6.4 Test: Notification appears when task completes
- [ ] 6.5 Test: Activity log shows recent events
