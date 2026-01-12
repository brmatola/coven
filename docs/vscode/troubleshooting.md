# Troubleshooting

Solutions for common Coven issues.

## Connection Issues

### "covend: disconnected" in Status Bar

**Symptoms:**
- Status bar shows disconnected state
- Sidebar empty or shows stale data
- Commands fail with connection errors

**Solutions:**

1. **Restart the daemon:**
   - Run `Coven: Restart Daemon`
   - Wait for reconnection

2. **Check daemon process:**
   ```bash
   ps aux | grep covend
   ```
   If not running, start a session.

3. **Check socket file:**
   ```bash
   ls -la /tmp/coven*.sock
   ```
   If missing, restart daemon.

4. **View daemon logs:**
   - Run `Coven: View Daemon Logs`
   - Look for error messages

### "Reconnection Failed" Notification

**Symptoms:**
- Toast notification about failed reconnection
- Status bar shows warning state

**Solutions:**

1. Click **Retry** in the notification
2. If retry fails, run `Coven: Restart Daemon`
3. If still failing, check for port/socket conflicts

## Session Issues

### Can't Start Session

**Symptoms:**
- Start session command fails
- Error about prerequisites

**Solutions:**

1. **Check prerequisites:**
   - Is git installed? Run `git --version`
   - Is workspace a git repo? Check for `.git/` directory
   - Is Claude CLI installed? Run `claude --version`
   - Is Claude CLI authenticated? Try `claude "hello"` to verify API key

2. **Initialize git if needed:**
   - Run `git init` if not a git repo
   - Make at least one commit: `git commit --allow-empty -m "Initial commit"`

3. **Check for existing session:**
   - Only one session per workspace
   - Stop existing session first

### Session Won't Stop

**Symptoms:**
- Stop session hangs
- Tasks still showing as active

**Solutions:**

1. **Force stop:**
   - Run `Coven: Force Stop Session`

2. **Manual cleanup:**
   ```bash
   # Find and kill daemon
   pkill -f covend

   # Remove socket
   rm /tmp/coven*.sock
   ```

3. **Reload window:**
   - Run `Developer: Reload Window`

## Task Issues

### Task Stuck in "Active"

**Symptoms:**
- Task shows running but no progress
- No agent output appearing
- Elapsed time increasing with no activity

**Solutions:**

1. **Check agent output:**
   - Right-click task > View Output
   - Look for errors or hangs

2. **Stop and restart:**
   - Stop the task
   - Check task description is clear
   - Start again

3. **View daemon logs:**
   - May show agent spawn failures

### Task Stuck in "Blocked"

**Symptoms:**
- Task in Blocked section
- Can't start it

**Solutions:**

1. **Check block reason:**
   - Open Task Detail panel
   - See why it's blocked (error message or manual block)

2. **Unblock the task:**
   ```bash
   coven task unblock <id>
   ```

3. **Check task details via CLI:**
   ```bash
   coven task show <id>        # See full task details
   coven task list --status=blocked  # See all blocked tasks
   ```

### Task Disappeared

**Symptoms:**
- Task was visible, now gone
- Not in any section

**Solutions:**

1. **Check all sections:**
   - Expand Completed section (collapsed by default)
   - Check Blocked section

2. **Refresh view:**
   - Click refresh button in sidebar header
   - Or run `Coven: Refresh Tasks`

3. **Check via CLI:**
   ```bash
   coven task list                    # All open tasks
   coven task list --status=closed    # Closed tasks
   coven task show <id>               # Specific task by ID
   ```

## Agent Issues

### Claude CLI Not Authenticated

**Symptoms:**
- Agent starts but immediately fails
- Error mentions "API key" or "authentication"
- "Unauthorized" or "401" errors in logs

**Solutions:**

1. **Verify Claude CLI works standalone:**
   ```bash
   claude "Say hello"
   ```
   If this fails with auth errors, your API key isn't configured.

2. **Configure Claude CLI authentication:**
   - Follow [Claude CLI setup](https://github.com/anthropics/claude-code)
   - Set `ANTHROPIC_API_KEY` environment variable
   - Or use `claude config` to set credentials

3. **Restart VS Code after configuring:**
   - The daemon needs to pick up new environment variables

### Agent Not Starting

**Symptoms:**
- Task starts but agent never spawns
- No output appearing

**Solutions:**

1. **Check Claude CLI:**
   ```bash
   which claude
   claude --version
   ```
   Must be in PATH.

2. **Check worktree creation:**
   ```bash
   git worktree list
   ```
   Should show worktree for the task.

3. **View daemon logs:**
   - Look for spawn errors
   - Check for permission issues

### Agent Crashes Immediately

**Symptoms:**
- Task starts then immediately fails
- Error about agent failure

**Solutions:**

1. **Check task description:**
   - Is it clear and actionable?
   - Does it reference files that exist?

2. **Check workspace state:**
   - Is git repo in clean state?
   - Are there uncommitted changes blocking worktree?

3. **Try simpler task:**
   - Create a minimal test task
   - Verify basic agent execution works

### Agent Output Not Showing

**Symptoms:**
- Task running but no output visible
- Workflow Detail panel empty

**Solutions:**

1. **Check SSE connection:**
   - Status bar should show connected state
   - Try restarting session

2. **Open output channel directly:**
   - Right-click task > View Output
   - Look in Output panel for "Familiar: xxx"

3. **Check daemon logs:**
   - May show streaming errors

## Review Issues

### Review Panel Won't Open

**Symptoms:**
- Click Review but nothing happens
- Error about missing workflow

**Solutions:**

1. **Refresh tasks:**
   - Task state may be stale
   - Click refresh in sidebar

2. **Check task status:**
   - Must be in Completed state
   - If still Active, wait for completion

### Merge Conflicts

**Symptoms:**
- Approve fails with conflict error
- Review panel shows conflict state

**Solutions:**

1. **Open worktree:**
   - Click "Open Worktree" in review panel
   - Opens new VS Code window in worktree

2. **Resolve conflicts:**
   - Use standard git conflict resolution
   - Edit conflicting files
   - Stage and commit resolution

3. **Retry merge:**
   - Return to review panel
   - Click "Retry Merge"

### Pre-merge Checks Failing

**Symptoms:**
- Checks show red X
- Approve button disabled

**Solutions:**

1. **Review failures:**
   - Click each failed check for details
   - May be test failures, lint errors, etc.

2. **Override if appropriate:**
   - Some checks can be overridden
   - Use with caution

3. **Fix issues manually:**
   - Open worktree
   - Fix the failing checks
   - Commit fixes
   - Retry review

## Performance Issues

### Sidebar Slow to Update

**Symptoms:**
- Tasks take long to appear
- Updates feel laggy

**Solutions:**

1. **Reduce active workflows:**
   - Fewer concurrent agents = less event traffic

2. **Restart daemon:**
   - Clears any accumulated state

### High CPU from Daemon

**Symptoms:**
- `covend` using lots of CPU
- System feels slow

**Solutions:**

1. **Check running agents:**
   - Multiple agents consume resources
   - Stop unnecessary tasks

2. **Restart daemon:**
   - Run `Coven: Restart Daemon`

3. **Check for loops:**
   - View daemon logs
   - Look for repeated errors

## Getting Help

If issues persist:

1. **Collect logs:**
   - Daemon logs: `Coven: View Daemon Logs` or `coven daemon logs`
   - Extension logs: Output panel > "Coven"

2. **Check versions:**
   ```bash
   coven --version
   claude --version
   go version
   node --version
   ```

3. **Check daemon status:**
   ```bash
   coven daemon status
   ```

4. **Minimal reproduction:**
   - Create fresh workspace with `git init`
   - Make one commit
   - Start session, create simple task
   - Document steps to reproduce the issue
