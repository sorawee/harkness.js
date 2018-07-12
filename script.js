(function () {
    /**
     * @typedef Record
     * @type {object}
     * @property {number} id
     * @property {string} user
     * @property {number} duration
     * @property {string} topic
     * @property {string} note
     */

    /**
     * @typedef Current
     * @type {?object}
     * @property {string} user
     * @property {number} duration
     * @property {string} note
     * @property {?number} latestStartTime
     * @property {string} topic
     */


    /* Constants */

    const USER_COLUMNS = 2;
    const OFFSET_PIXELS = 3;
    const COMMANDS = [
        'start-log',
        'pause-log',
        'edit-log',
        'remove-log',
        'add-users',
        'delete-users',
        'note',
        'new-topic',
    ];

    /* Variables */

    let users = [];

    const topics = [];

    // map a topic to its hue number, not its color
    const mapTopicColor = {};
    mapTopicColor[null] = 0;

    let lastestHue = 0;

    /** @type {Current} */
    let current = null;

    let database = [];

    let currentId = 1;

    let currentTopic = '';

    /*
      All rows in the table come from both `database` and `current`. `current` should always be non-`null` unless
      there's absolutely no rows. As such, `current == null` implies `database.length == 0`
    */

    function setPopUpTrue(){
      window.onbeforeunload = function(e) {
        e.returnValue = "not Null";
     };
    }

    /**
     * @param {number} id
     * @param {string} user
     * @param {number} duration
     * @param {string} note
     * @param {string} topic
     * @returns {Record}
     */
    function makeRecord(id, user, topic, duration, note) {
        return {
            id: id,
            user: user,
            topic: topic,
            duration: duration,
            note: note,
        };
    }

    function getLabels() {
        return database.map(row => row.id).concat(current == null ? [] : [current.id]);
    }

    function prefixMatcher(q, cb) {
        const autocomplete = [
            {
                pattern: ':delete-users ',
                target: () => users
            },
            {
                pattern: ':start-log ',
                target: () => [''].concat(users)
            },
            {
                pattern: ':remove-log ',
                target: getLabels
            },
            {
                pattern: ':edit-log \\d+ user ',
                target: () => users
            },
            {
                pattern: ':edit-log \\d+ ',
                target: () => ['user', 'duration', 'note']
            },
            {
                pattern: ':edit-log ',
                target: getLabels
            },
            {
                pattern: ':new-topic ',
                target: () => topics
            },
            {
                pattern: ':',
                target: () => COMMANDS
            },
            {
                pattern: '\\+',
                target: () => [''].concat(users)
            }
        ];

        autocomplete.some(({pattern, target}) => {
            const result = (new RegExp('^' + pattern)).exec(q);
            if (result == null) return false;

            const matches = [];
            for (const str of target()) {
                if ((result[0] + str).toLowerCase().startsWith(q.toLowerCase())) {
                    matches.push(result[0] + str + ' ');
                }
            }
            cb(matches);
            return true;
        });
    }

    function getCurrentSec() {
        return Math.floor(Date.now() / 1000);
    }

    function setCurrent(id, user, topic, duration, latestStartTime, note) {
        current = {
            id: id,
            user: user,
            topic: topic,
            duration: duration,
            latestStartTime: latestStartTime,
            note: note
        };
    }

    /**
     * @param {number} n
     */
    function durationToString(n) {
        const seconds = n % 60;
        const mins = Math.floor(n / 60);
        return `${mins} m ${seconds} s`;
    }

    function getFreshDatabase() {
        return database.concat((current != null) ? [getCurrentRecordUnsafe()] : []);
    }

    function popRecordAndRow() {
        if (current == null) return;
        if (database.length > 0) {
            const lastRow = database.pop();
            setCurrent(lastRow.id, lastRow.user, lastRow.topic, lastRow.duration, null, lastRow.note);
            currentId = lastRow.id;
        } else {
            current = null;
            currentId = 1;
        }
        removeLastRowUnsafe();
    }

    function isUserActive(user) {
        return current != null && current.user == user && current.latestStartTime != null;
    }

    /* Precondition: current != null */
    function getCurrentRecordUnsafe() {
        return makeRecord(current.id, current.user, current.topic, getCurrentDurationUnsafe(), current.note);
    }

    /* Precondition: current != null */
    function getCurrentDurationUnsafe() {
        return current.duration +
            ((current.latestStartTime == null) ?
             0 : getCurrentSec() - current.latestStartTime);
    }

    function refreshUsers() {
        const tds = users.map(user => {
            const td = $('<td/>')
                  .text(user)
                  .click(e => update(isUserActive(user) ?
                                     ':pause-log' :
                                     `:start-log ${user}`));
            if (isUserActive(user)) td.addClass('active');
            return td;
        }).reverse();

        const ul = $('#userList tbody');
        ul.empty();

        while (tds.length > 0) {
            const tr = $('<tr/>');
            for (let i = 0; i < USER_COLUMNS && tds.length > 0; i++) {
                tr.append(tds.pop());
            }
            ul.append(tr);
        }
    }

    function refreshLogs() {
        clearLogTable();
        for (const row of getFreshDatabase()) {
            appendTableRow(recordToRow(row));
        }
    }

    /**
     * @param {Record} record
     * @returns {JQuery}
     */
    function recordToRow(record) {
        function clickEvent(field, val) {
            return e => {
                $('#command').typeahead('val', `:edit-log ${record.id} ${field} ${JSON.stringify(val)}`);
                $('#command').focus();
            };
        }
        const tr = $('<tr/>')
              .append($('<td/>').text(record.id))
              .append($('<td/>').text(record.user).click(clickEvent('user', record.user)))
              .append($('<td/>').text(record.topic).click(clickEvent('topic', record.topic)))
              .append($('<td/>').text(durationToString(record.duration)).click(clickEvent('duration', record.duration)))
              .append($('<td/>').text(record.note).click(clickEvent('note', record.note)));
        if (current != null && record.id == currentId && current.latestStartTime != null) {
            tr.addClass('active');
        }
        return tr;
    }

    function scrollLog() {
        const elem = document.getElementById('app-container');
        elem.scrollTop = elem.scrollHeight;
    }

    function log(msg) {
        function pad(x) {
            x = x + '';
            if (x.length == 1) {
                x = '0' + x;
            }
            return x;
        }
        const now = new Date();
        msg = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` + ' ' + msg;
        $('#message').val($('#message').val() + '\r\n' + msg);

        const textarea = document.getElementById('message');
        textarea.scrollTop = textarea.scrollHeight;
    }

    function appendTableRow(tr) {
        $('#app-table tbody').append(tr);
        colorTopicCells();
    }

    function colorTopicCells() {
      $('#app-table tbody tr').each(function(index) {
          const topicCell = $(this).find('td:eq(2)');
          const text = topicCell.text();
          const hue = mapTopicColor[text];
          if (text != null && hue == null) {
            addNewTopic(text);
          }
          topicCell.css('background-color', `hsl(${hue}, 70%, 81%)` );
      });
    }

    function addNewTopic(topic) {
      lastestHue += 137;
      if (lastestHue > 360) {
        lastestHue -= 360;
      }
      mapTopicColor[topic] = lastestHue;
      topics.push(topic);
      log(`Topic ${topic} is added.`);
    }

    /* Precondition: current != null */
    function removeLastRowUnsafe() {
        $('#app-table tbody tr:last').remove();
    }

    function clearLogTable() {
        $('#app-table tbody').empty();
    }

    function parse(cmd) {
        try {
            return parser.parse(cmd);
        } catch (e) {
            if (e instanceof parser.SyntaxError) {
                log(`Attempting to parse: ${cmd}`);
                log(`Parse error: ${e.message}`);
            }
        }
        return null;
    }

    /**
     * @param {string} target
     */
    function getRecordIndex(target) {
        const id = Number(target);
        if (Number.isNaN(id)) {
            log(`${target} is not a log id. Aborted.`);
            return null;
        }
        const index = database.findIndex(record => record.id == id);
        if (index == -1) log(`Log id ${id} is not found. Aborted.`);
        return index;
    }

    function update(cmd) {
        cmd = cmd.trim();
        let mode = null;
        let args = null;
        if (cmd.startsWith('+')) {
            mode = 'start-log';
            args = parse(cmd.substr(1));
            if (args == null) return;
        } else if (cmd.startsWith(':')) {
            args = parse(cmd.substr(1));
            if (args == null) return;
            mode = args.shift();
        } else {
            mode = 'note';
            args = [cmd];
        }

        function badArity(comb) {
            if (!comb.pred(args.length)) {
                log(`Wrong number of arguments: expect ${comb.error}, got ${args.length}`);
                return true;
            }
            return false;
        }

        switch (mode) {
        case 'start-log': {
            if (badArity(arity.LE(1))) return;

            if (args.length == 0) {
                if (current == null) {
                    log(`Can't start. Aborted.`);
                    return;
                }
                args.push(current.user);
            }

            const user = args[0];

            if (! users.includes(user)) {
                log(`User ${user} is not in the user list. Aborted.`);
                return;
            }

            if (current != null && user == current.user) {
                if (current.latestStartTime != null) {
                    log(`User ${current.user} has already started. Aborted.`);
                    return;
                }
                current.latestStartTime = getCurrentSec();
            } else {
                if (current != null) {
                    const record = getCurrentRecordUnsafe();
                    database.push(record);
                    setPopUpTrue();
                    currentId++;
                    removeLastRowUnsafe();
                    appendTableRow(recordToRow(record));
                    log(`User ${current.user} finishes after ${durationToString(record.duration)}`);
                }
                setCurrent(currentId, user, currentTopic, 0, getCurrentSec(), '');
                appendTableRow(recordToRow(getCurrentRecordUnsafe()));
            }
            scrollLog();
            refreshUsers(); // could be more efficient, but we don't care here

            log(`User ${user} starts.`);

        } break;

        case 'remove-log': {
            if (badArity(arity.EQ(1))) return;
            const target = args[0];
            if (target != current.id) {
                const rowIndex = getRecordIndex(target);
                if (rowIndex == -1) return;
                database.splice(rowIndex, 1);
                refreshLogs();
            } else {
                popRecordAndRow();
                refreshUsers(); // could be more efficient, but we don't care here
            }

            log(`Remove log ${target}`);
        } break;

        case 'pause-log': {
            if (badArity(arity.EQ(0))) return;
            if (current == null) {
                log("Can't pause. Aborted");
                return;
            }
            current.duration = getCurrentDurationUnsafe();
            current.latestStartTime = null;

            scrollLog();
            refreshUsers(); // could be more efficient, but we don't care here

            log('Paused.');

        } break;

        case 'edit-log': {
            if (badArity(arity.EQ(3))) return;
            if (current == null) {
                log("Can't edit.");
                return;
            }

            const target = args[0];
            const field = args[1];
            const val = args[2];

            let rowObj;

            if (target == current.id) {
                rowObj = getCurrentRecordUnsafe();
            } else {
                const rowIndex = getRecordIndex(target);
                if (rowIndex == -1) return;
                rowObj = database[rowIndex];
            }

            switch (field) {
            case 'user': {
                if (! users.includes(val)) {
                    log(`${val} is not in the user list. Aborted.`);
                    return;
                }
                rowObj.user = val;
            } break;

            case 'duration': {
                const duration = Number(val);
                if (Number.isNaN(duration)) {
                    log(`${val} is not a duration (in seconds). Aborted.`);
                    return;
                }
                rowObj.duration = duration;
            } break;

            case 'note': {
                rowObj.note = val;
            } break;

            case 'topic': {
                if (! topics.includes(val)) {
                  addNewTopic(val);
                  log(`Topic ${val} is added.`);
                }
                rowObj.topic = val;
            } break;

            default:
                log(`Unknown subcommand: ${field}`);
                return;
            }

            if (target == current.id) {
                current.user = rowObj.user;
                current.topic = rowObj.topic;
                current.duration = rowObj.duration;
                current.note = rowObj.note;
                if (field == 'duration' && current.latestStartTime != null) {
                    current.latestStartTime = getCurrentSec();
                }
            }
            // no need to update otherwise since we mutate the structure directly already
            // don't scroll since the edit could be on non-last rows
            refreshLogs();

            log(`Edited.`);
        } break;

        case 'note': {
            if (current == null) {
                log(`Can't note. Aborted.`);
                return;
            }
            current.note += args[0] + '\n';
            scrollLog();

            log('Note added.');
        } break;

        case 'add-users': {
            for (const user of args) {
                if (users.includes(user)) {
                    log(`User ${user} already exists. Skipped.`);
                    return;
                }
                users.push(user);

                log(`User ${user} is added.`);
            }

            refreshUsers(); // could be more efficient, but we don't care here
        } break;

        case 'delete-users': {
            const currentFreshDatabase = getFreshDatabase();
            for (const user of args) {
                const idx = users.indexOf(user);
                if (idx == -1) {
                    log(`${user} is not a user. Skipped.`);
                    return;
                }
                if (currentFreshDatabase.some(record => record.user == user)) {
                    log(`${user} exists in the log. Skipped.`);
                    return;
                }

                users.splice(idx, 1);
                log(`User ${user} is removed.`);
            }

            refreshUsers(); // could be more efficient, but we don't care here
        } break;

        case 'new-topic': {
          if (badArity(arity.LE(1))) return;
          const topic = args[0];

          function startNewTopic() {
            const pastTopic = currentTopic
            currentTopic = topic;
            log(`Start topic ${topic}`)

            if (current != null) {
              const record = getCurrentRecordUnsafe();
              database.push(record);
              currentId++;
              removeLastRowUnsafe();
              appendTableRow(recordToRow(record));
              log(`User ${current.user} finishes talking about ${pastTopic} after ${durationToString(record.duration)}`);
              setCurrent(currentId, current.user, currentTopic, 0, getCurrentSec(), '');
              appendTableRow(recordToRow(getCurrentRecordUnsafe()));
            }
          }


          if (topics.includes(topic)) {
            log(`Topic ${topic} already exists. Skipped.`);
            startNewTopic();
            return;
          }
          addNewTopic(topic);
          startNewTopic();
        } break;

        default:
            log(`Unknown command: ${mode}`);
            return;
        }
    }

    setInterval(() => {
        if (current != null) {
            const elem = document.getElementById('app-container');
            const offset = elem.scrollHeight - elem.scrollTop - elem.clientHeight;
            removeLastRowUnsafe();
            appendTableRow(recordToRow(getCurrentRecordUnsafe()));
            if (Math.abs(offset) <= OFFSET_PIXELS) {
                elem.scrollTop = elem.scrollHeight;
            }
        }
    }, 500);


    $('#command').typeahead({
        highlight: true,
    }, {
        source: prefixMatcher
    });

    $('#command').keyup(e => {
        if (e.keyCode == 13) {
            update($('#command').val());
            $('#command').typeahead('val', '');
        }
    });

    $('body').keyup(e => {
        if (e.keyCode == 9) {
            $('#command').focus();
        }
    });

    refreshUsers();

    $('#command').focus();

    $('#file-save').click(e => {
        log('Save requested');
        const saver = $('#file-save');
        saver.attr('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(
            Papa.unparse(users.map(user => makeRecord(-1, user, '', 0, '')).concat(getFreshDatabase()))
        ));
        window.onbeforeunload = function(e){};
        setTimeout(setPopUpTrue, 20000);
        saver.attr('download', 'harkness-log.csv');
    });

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = Papa.parse(reader.result, {header: true, skipEmptyLines: true});
        if (data.errors.length > 0) {
            log(`Can't load. because of the following errors: ${data.errors}. Aborted.`);
            return;
        }
        // TODO: need to handle malformed csv
        // this includes when users appear in log entries but not
        // user lists
        users = [];
        database = [];
        clearLogTable();
        for (const record of data.data) {
            // TODO: this should log an error message if it errors
            record.duration = Number(record.duration);
            if (record.id == -1) {
                users.push(record.user);
            } else {
                database.push(record);
                appendTableRow(recordToRow(record));
            }
        }

        // this is so that we can call popRecordAndRow
        // which will set everything up
        setCurrent(0, '', '', 0, null, '');
        appendTableRow(recordToRow(getCurrentRecordUnsafe()));
        popRecordAndRow();

        refreshUsers();
        log('Load successfully');
    };

    $('#file-load').change(e => {
        const f = e.target.files[0];
        if (f) reader.readAsText(f);
    });


    function d3eval(inputData) {
        const b = 300;
        const a = 100;
        var diameter = 400,
            width = 800,
            radius = diameter / 2,
            innerRadius = radius - 50;

        var cluster = d3.cluster()
            .size([360, innerRadius]);

        function getNewDY(d) {
            const theta = Math.abs(d.x / 180 * Math.PI);
            const cosComp = b * Math.cos(theta);
            const sinComp = a * Math.sin(theta);
            return a * b * d.y / (innerRadius *
                                  Math.sqrt(cosComp * cosComp +
                                            sinComp * sinComp));
        }

        function getLine() {
            const randomFactor = 0.5 + (Math.random() * 0.5);
            return d3.radialLine()
                .curve(d3.curveBundle.beta(randomFactor))
                .radius(getNewDY)
                .angle(function(d) { return d.x / 180 * Math.PI; });
        }

        var svg = d3.select("#vizDiv").append("svg")
            .attr("width", width)
            .attr("height", diameter)
            .append("g")
            .attr("transform", "translate(" + width/2 + "," + diameter/2 + ")");

        var link = svg.append("g").selectAll(".link"),
            node = svg.append("g").selectAll(".node");

        function load(classes) {
            var root = packageHierarchy(classes)
                .sum(function(d) { return d.size; });

            cluster(root);

            link = link
                .data(packageImports(root.leaves()))
                .enter().append("path")
                .each(function(d) {
                    d.source = d[0], d.target = d[d.length - 1];
                })
                .attr("class", "link")
                .each(function(d) {
                    d3.select(this).attr("d", getLine());
                });

            node = node
                .data(root.leaves())
                .enter().append("text")
                .attr("class", "node")
                .attr("dy", "0.31em")
                .attr("transform", function(d) { return "rotate(" + (d.x - 90) + ")translate(" + (getNewDY(d) + 8) + ",0)" + (d.x < 180 ? "" : "rotate(180)"); })
                .attr("text-anchor", function(d) { return d.x < 180 ? "start" : "end"; })
                .text(function(d) { return d.data.key; })
                .on("mouseover", mouseovered)
                .on("mouseout", mouseouted);
        };

        function mouseovered(d) {
            node
                .each(function(n) { n.target = n.source = false; });

            link
                .classed("link--target", l => {
                    if (l.target === d) return l.source.source = true;
                    return null;
                })
                .classed("link--source", l => {
                    if (l.source === d) return l.target.target = true;
                    return null;
                })
                .filter(l => l.target === d || l.source === d)
                .raise();

            node
                .classed("node--target", n => n.target)
                .classed("node--source", n => n.source);
        }

        function mouseouted(d) {
            link
                .classed("link--target", false)
                .classed("link--source", false);

            node
                .classed("node--target", false)
                .classed("node--source", false);
        }

        // Lazily construct the package hierarchy from class names.
        function packageHierarchy(classes) {
            const root = {name: '', children: []};
            root.children = classes.map(d => {
                d.parent = root;
                d.children = [];
                d.key = d.name;
                return d;
            });
            return d3.hierarchy(root);
        }

        // Return a list of imports for the given array of nodes.
        function packageImports(nodes) {
            var map = {},
                imports = [];

            // Compute a map from name to node.
            nodes.forEach(function(d) {
                map[d.data.name] = d;
            });

            // For each import, construct a link from the source to target node.
            nodes.forEach(function(d) {
                if (d.data.links) d.data.links.forEach(function(i) {
                    imports.push(map[d.data.name].path(map[i]));
                });
            });

            return imports;
        }

        const mapUsers = {};
        for (const user of users) {
            mapUsers[user] = [];
        }
        for (let i = 0; i < inputData.length - 1; i++) {
            if (inputData[i].user == inputData[i + 1].user) continue;
            mapUsers[inputData[i].user].push(inputData[i + 1].user);
        }
        load(users.map(e => ({name: e, links: mapUsers[e]})));
    };

    google.charts.load('current', {packages: ['corechart', 'bar', 'timeline']});
    google.charts.setOnLoadCallback(setupGoogleCharts);

    function setupGoogleCharts() {
      const chart = new google.visualization.ColumnChart(document.getElementById('chartDiv'));
      const timeline = new google.visualization.Timeline(document.getElementById('vizTimeline'));

      function drawColColors() {
        const spentTime = {};
        for (const user of users) {
          spentTime[user] = {};
          for (const topic of topics) {
            (spentTime[user])[topic] = 0;
          }
          (spentTime[user]).total = 0;
        }

        let maxValue = 0;

        for (const record of getFreshDatabase()) {
          (spentTime[record.user])[record.topic] += record.duration;
          (spentTime[record.user]).total += record.duration;
          maxValue = Math.max(spentTime[record.user].total, maxValue);
        }

        const data = new google.visualization.DataTable();
        data.addColumn('string', 'User');
        for (const topic of topics) {
          data.addColumn('number', `${topic}`);
        }
        data.addColumn({ type: 'string', id: 'Total Time', role: 'annotation' });
        data.addRows(users.map(user => [user].concat(topics.map(topic => (spentTime[user])[topic])).concat([`${(spentTime[user]).total} s`])));

        const options = {
          isStacked: true,
          title: 'Aggregated time, in seconds',
          hAxis: {
            title: 'User',
          },
          vAxis: {
            title: 'Number of times spoken',
            gridlines: {count: -1},
            minValue: 0,
          },
          width: 700,
          height: 400,
          legend: {
            position: 'bottom',
            maxLines: 3,
          },
          colors: topics.map(topic => `${hslToHex(mapTopicColor[topic], 70, 81)}`),
        };

        if (maxValue < 2) {
          options.vAxis.maxValue = 2;
        }

        chart.draw(data, options);
      }

      $('#chart-tab').click(drawColColors);

      function drawVizTimeline(freshData) {
        const time_by_topic = [];
        let cur_time = 0;
        const hue_by_time = [];

        function makeTopicRecordByTime(topic, start, end, id) {
          return {
            topic: topic,
            start: start,
            end: end,
            id: [id],
          };
        }

        function numToSecond(n) {
          return n * 1000;
        }

        function addNewTopic(record) {
          time_by_topic.push(makeTopicRecordByTime(record.topic, numToSecond(cur_time), numToSecond(cur_time + record.duration), record.id));
          cur_time += record.duration;
          hue_by_time.push(mapTopicColor[record.topic]);
        }

        for (const record of freshData) {
          if (time_by_topic.length == 0) {
            addNewTopic(record);
            continue;
          }
          const last_record = time_by_topic.pop();
          if (record.topic != last_record.topic) {
            time_by_topic.push(last_record);
            addNewTopic(record);
            continue;
          }
          last_record.end += numToSecond(record.duration);
          last_record.id.push(record.id);
          time_by_topic.push(last_record);
          cur_time += record.duration;
        }

        const dataTable = new google.visualization.DataTable();
        dataTable.addColumn({ type: 'string', id: 'Topic' });
        dataTable.addColumn({ type: 'string', id: 'Name' });
        dataTable.addColumn({ type: 'number', id: 'Start' });
        dataTable.addColumn({ type: 'number', id: 'End' });
        dataTable.addRows(time_by_topic.map(record => ['Topic', record.topic, record.start, record.end]));

        const options = {
          title: 'Timeline by Topics',
          height: 100,
          width: 700,
          colors: hue_by_time.map(hue => `${hslToHex(hue, 70, 81)}`),
          timeline: { showRowLabels: false },
        };
        timeline.draw(dataTable, options);
        google.visualization.events.addListener(timeline, 'select', timelineSelectHandler);

        function timelineSelectHandler(e) {
          const item = timeline.getSelection();
          const start = dataTable.getValue(item[0].row, 2);
          const id = time_by_topic[time_by_topic.findIndex(record => record.start == start)].id;
          let last_id = id[id.length-1];
          let first_id = id[0]-1;
          if (last_id > database.length) last_id = null;
          if (first_id < 0) first_id = null;

          function getGraph(data) {
            $('#vizDiv').empty();
            d3eval(data);
          }

          if (first_id == null && last_id == null) return;
          if (first_id == null) {
            getGraph(database.slice(id.length-database.length));
            return;
          }
          if (last_id == null) {
            getGraph(database.slice(first_id));
            return;
          }
          getGraph(database.slice(first_id, last_id));
        }

      }


      $('#viz-tab').click(e => {
          const freshData = getFreshDatabase();
          $('#vizDiv').empty();
          d3eval(freshData);
          drawVizTimeline(freshData);
      });
    }

    function hslToHex(h, s, l) {
      h /= 360;
      s /= 100;
      l /= 100;
      let r, g, b;
      if (s === 0) {
        r = g = b = l; // achromatic
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }
      const toHex = x => {
        const hex = Math.round(x * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      };
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
})();
