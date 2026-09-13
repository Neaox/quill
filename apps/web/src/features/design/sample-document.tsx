import { Block, Callout, Prose, ProseTable } from '@quill/ui'

import { HighlightedCode } from './highlighted-code.tsx'
import landscape from './landscape.svg'

/**
 * A worked example of the reading surface.
 *
 * Every element a Markdown document can produce appears once, at the width it
 * would really be given: body text at the reading measure, a table at `wide`,
 * and a diagram at `full`. Nothing here carries a class of its own; the
 * typography is applied by element, exactly as it will be when this HTML comes
 * out of the Markdown pipeline.
 */
export function SampleDocument() {
  return (
    <Prose label="Sample document: regional failover">
      <h1>Regional failover</h1>
      <p>
        What to do when the primary region stops answering, who to tell, and how to decide whether
        to fail back. This runbook is rehearsed once a quarter.
      </p>

      <p className="front-matter">
        <span>type=runbook</span>
        <span>review=90d</span>
        <span>last-reviewed=2026-08-15</span>
      </p>

      <h2>Before you start</h2>
      <p>
        Failover is a decision, not a reflex. A region that is slow is not a region that is down,
        and a failover costs roughly eleven minutes of write availability. Read{' '}
        <a href="#preconditions">the preconditions</a> first, then confirm with the on-call lead
        that the primary is genuinely unreachable rather than merely degraded.
      </p>

      <ol>
        <li>
          Confirm the alert in two independent places: the health probe and a real request from
          outside the network.
        </li>
        <li>
          Announce the decision in the incident channel, with the time and the reason, before you
          change anything.
        </li>
        <li>
          Run <code>failover promote --region eu-west</code> and watch the replication lag settle.
        </li>
      </ol>

      <Callout tone="warning" title="Failover is one-way until the primary is healthy">
        Promotion changes which region accepts writes. Failing back before replication has caught up
        loses every write made in the meantime.
      </Callout>

      <h2 id="preconditions">Latency budgets</h2>
      <p>
        Each region has a budget for the ninety-fifth percentile of a cached document open. A region
        over budget for more than ten minutes is a candidate for failover; a region over budget
        briefly is a candidate for patience.
      </p>

      <Block width="wide">
        <ProseTable label="Latency budgets by region">
          <table>
            <caption>
              Measured at the edge, ninety-fifth percentile, over the trailing seven days.
            </caption>
            <thead>
              <tr>
                <th scope="col">Region</th>
                <th scope="col">Endpoint</th>
                <th scope="col">Budget</th>
                <th scope="col">Trailing week</th>
                <th scope="col">Owner</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">eu-west</th>
                <td>
                  <code>/documents/:id</code>
                </td>
                <td>200 ms</td>
                <td>146 ms</td>
                <td>Platform</td>
              </tr>
              <tr>
                <th scope="row">us-east</th>
                <td>
                  <code>/documents/:id</code>
                </td>
                <td>200 ms</td>
                <td>171 ms</td>
                <td>Platform</td>
              </tr>
              <tr>
                <th scope="row">ap-south</th>
                <td>
                  <code>/documents/:id</code>
                </td>
                <td>300 ms</td>
                <td>318 ms</td>
                <td>Edge</td>
              </tr>
              <tr>
                <th scope="row">eu-west</th>
                <td>
                  <code>/search</code>
                </td>
                <td>300 ms</td>
                <td>204 ms</td>
                <td>Search</td>
              </tr>
            </tbody>
          </table>
        </ProseTable>
      </Block>

      <h2>Promoting a replica</h2>
      <p>
        The command is idempotent: running it twice against an already-promoted region prints the
        current state and exits without changing anything.
      </p>

      <pre tabIndex={0} role="group" aria-label="Failover commands">
        <code>
          <HighlightedCode
            language="bash"
            code={`# Confirm the replica is caught up before promoting.
failover status --region eu-west --format json \\
  | jq '.replication.lagSeconds'

# Promote. Writes move within about eleven minutes.
failover promote --region eu-west --confirm`}
          />
        </code>
      </pre>

      <p>
        If the command refuses, it will say why. Press <kbd>Ctrl</kbd> + <kbd>C</kbd> and escalate
        rather than adding <code>--force</code>: the flag exists for disaster recovery drills, not
        for incidents.
      </p>

      <blockquote>
        <p>
          The failover that goes badly is almost never the one where the tooling failed. It is the
          one where nobody wrote down what &ldquo;down&rdquo; meant.
        </p>
        <cite>Post-incident review, March</cite>
      </blockquote>

      <h2>How the pieces fit together</h2>
      <p>
        Reads are served from whichever region is closest; writes go to the primary and reach the
        others through replication. The search index is a consumer of the same event stream, so it
        is eventually consistent by design rather than by accident.
      </p>

      <Block width="full">
        <figure>
          <img
            src={landscape}
            alt="System landscape: the reading surface and the editor both talk to the application layer, which writes to the content store, Postgres, and the search index"
          />
          <figcaption>
            The reading surface and the editor both talk to the application layer; only the
            application layer knows about storage.
          </figcaption>
        </figure>
      </Block>

      <hr />

      <h3>Definitions</h3>
      <dl>
        <dt>Down</dt>
        <dd>Two consecutive external probes fail from two different networks.</dd>
        <dt>Degraded</dt>
        <dd>Latency over budget, but requests are still being answered correctly.</dd>
        <dt>Failback</dt>
        <dd>Returning writes to the original primary once replication has caught up.</dd>
      </dl>

      <ul>
        <li>
          Rehearsed quarterly, in <em>both</em> directions.
        </li>
        <li>
          The runbook is <strong>the</strong> source of truth; the dashboard is a convenience.
          <ul>
            <li>Nested lists keep the same rhythm as their parent.</li>
          </ul>
        </li>
      </ul>
    </Prose>
  )
}
