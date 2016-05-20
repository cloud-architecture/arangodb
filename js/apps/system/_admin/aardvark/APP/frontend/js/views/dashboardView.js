/*jshint browser: true */
/*jshint unused: false */
/*global Backbone, EJS, $, flush, window, arangoHelper, nv, d3, localStorage*/
/*global document, console, frontendConfig, Dygraph, _,templateEngine */

(function () {
  "use strict";

  function fmtNumber (n, nk) {
    if (n === undefined || n === null) {
      n = 0;
    }

    return n.toFixed(nk);
  }

  window.DashboardView = Backbone.View.extend({
    el: '#content',
    interval: 10000, // in milliseconds
    defaultTimeFrame: 20 * 60 * 1000, // 20 minutes in milliseconds
    defaultDetailFrame: 2 * 24 * 60 * 60 * 1000,
    history: {},
    graphs: {},

    events: {
      // will be filled in initialize
      "click .subViewNavbar .subMenuEntry" : "toggleViews"
    },

    tendencies: {
      asyncPerSecondCurrent: [
        "asyncPerSecondCurrent", "asyncPerSecondPercentChange"
      ],

      syncPerSecondCurrent: [
        "syncPerSecondCurrent", "syncPerSecondPercentChange"
      ],

      clientConnectionsCurrent: [
        "clientConnectionsCurrent", "clientConnectionsPercentChange"
      ],

      clientConnectionsAverage: [
        "clientConnections15M", "clientConnections15MPercentChange"
      ],

      numberOfThreadsCurrent: [
        "numberOfThreadsCurrent", "numberOfThreadsPercentChange"
      ],

      numberOfThreadsAverage: [
        "numberOfThreads15M", "numberOfThreads15MPercentChange"
      ],

      virtualSizeCurrent: [
        "virtualSizeCurrent", "virtualSizePercentChange"
      ],

      virtualSizeAverage: [
        "virtualSize15M", "virtualSize15MPercentChange"
      ]
    },

    barCharts: {
      totalTimeDistribution: [
        "queueTimeDistributionPercent", "requestTimeDistributionPercent"
      ],
      dataTransferDistribution: [
        "bytesSentDistributionPercent", "bytesReceivedDistributionPercent"
      ]
    },

    barChartsElementNames: {
      queueTimeDistributionPercent: "Queue",
      requestTimeDistributionPercent: "Computation",
      bytesSentDistributionPercent: "Bytes sent",
      bytesReceivedDistributionPercent: "Bytes received"

    },

    getDetailFigure : function (e) {
      var figure = $(e.currentTarget).attr("id").replace(/ChartButton/g, "");
      return figure;
    },

    showDetail: function (e) {
      var self = this,
          figure = this.getDetailFigure(e),
          options;

      options = this.dygraphConfig.getDetailChartConfig(figure);

      this.getHistoryStatistics(figure);
      this.detailGraphFigure = figure;

      window.modalView.hideFooter = true;
      window.modalView.hide();
      window.modalView.show(
        "modalGraph.ejs",
        options.header,
        undefined,
        undefined,
        undefined,
        undefined,
        this.events
      );

      window.modalView.hideFooter = false;

      $('#modal-dialog').on('hidden', function () {
        self.hidden();
      });

      $('#modal-dialog').toggleClass("modal-chart-detail", true);

      options.height = $(window).height() * 0.7;
      options.width = $('.modal-inner-detail').width();

      // Reselect the labelsDiv. It was not known when requesting options
      options.labelsDiv = $(options.labelsDiv)[0];

      this.detailGraph = new Dygraph(
        document.getElementById("lineChartDetail"),
        this.history[this.server][figure],
        options
      );
    },

    hidden: function () {
      this.detailGraph.destroy();
      delete this.detailGraph;
      delete this.detailGraphFigure;
    },


    getCurrentSize: function (div) {
      if (div.substr(0,1) !== "#") {
        div = "#" + div;
      }
      var height, width;
      $(div).attr("style", "");
      height = $(div).height();
      width = $(div).width();
      return {
        height: height,
        width: width
      };
    },

    prepareDygraphs: function () {
      var self = this, options;
      this.dygraphConfig.getDashBoardFigures().forEach(function (f) {
        options = self.dygraphConfig.getDefaultConfig(f);
        var dimensions = self.getCurrentSize(options.div);
        options.height = dimensions.height;
        options.width = dimensions.width;
        self.graphs[f] = new Dygraph(
          document.getElementById(options.div),
          self.history[self.server][f] || [],
          options
        );
      });
    },

    initialize: function (options) {
      this.options = options;
      this.dygraphConfig = options.dygraphConfig;
      this.d3NotInitialized = true;
      this.events["click .dashboard-sub-bar-menu-sign"] = this.showDetail.bind(this);
      this.events["mousedown .dygraph-rangesel-zoomhandle"] = this.stopUpdating.bind(this);
      this.events["mouseup .dygraph-rangesel-zoomhandle"] = this.startUpdating.bind(this);

      this.serverInfo = options.serverToShow;

      if (! this.serverInfo) {
        this.server = "-local-";
      } else {
        this.server = this.serverInfo.target;
      }

      this.history[this.server] = {};
    },

    toggleViews: function(e) {
      var id = e.currentTarget.id.split('-')[0], self = this;
      var views = ['replication', 'requests', 'system'];

      _.each(views, function(view) {
        if (id !== view) {
          $('#' + view).hide();
        }
        else {
          $('#' + view).show();
          self.resize();
          $(window).resize();
        }
      });

      $('.subMenuEntries').children().removeClass('active');
      $('#' + id + '-statistics').addClass('active');

      window.setTimeout(function() {
        self.resize();
        $(window).resize();
      }, 200);

    },
		
		cleanupHistory: function(f) {
			// clean up too big history data
			if (this.history[this.server].hasOwnProperty(f)) {
	      if (this.history[this.server][f].length > this.defaultTimeFrame / this.interval) {
			    while (this.history[this.server][f].length > this.defaultTimeFrame / this.interval) {
	          this.history[this.server][f].shift();
	        }
			  }
			}
		},

    updateCharts: function () {
      var self = this;
      if (this.detailGraph) {
        this.updateLineChart(this.detailGraphFigure, true);
        return;
      }
      this.prepareD3Charts(this.isUpdating);
      this.prepareResidentSize(this.isUpdating);
      this.updateTendencies();
      Object.keys(this.graphs).forEach(function (f) {
        self.updateLineChart(f, false);
      });
    },

    updateTendencies: function () {
      var self = this, map = this.tendencies;

      var tempColor = "";
      Object.keys(map).forEach(function (a) {
        var p = "";
        var v = 0;
        if (self.history.hasOwnProperty(self.server) &&
            self.history[self.server].hasOwnProperty(a)) {
          v = self.history[self.server][a][1];
        }

        if (v < 0) {
          tempColor = "#d05448";
        }
        else {
          tempColor = "#7da817";
          p = "+";
        }
        if (self.history.hasOwnProperty(self.server) &&
            self.history[self.server].hasOwnProperty(a)) {
          $("#" + a).html(self.history[self.server][a][0] + '<br/><span class="dashboard-figurePer" style="color: '
            + tempColor +';">' + p + v + '%</span>');
        }
        else {
          $("#" + a).html('<br/><span class="dashboard-figurePer" style="color: '
            + "#000" +';">' + '<p class="dataNotReadyYet">data not ready yet</p>' + '</span>');
        }
      });
    },


    updateDateWindow: function (graph, isDetailChart) {
      var t = new Date().getTime();
      var borderLeft, borderRight;
      if (isDetailChart && graph.dateWindow_) {
        borderLeft = graph.dateWindow_[0];
        borderRight = t - graph.dateWindow_[1] - this.interval * 5 > 0 ?
        graph.dateWindow_[1] : t;
        return [borderLeft, borderRight];
      }
      return [t - this.defaultTimeFrame, t];
    },

    updateLineChart: function (figure, isDetailChart) {

      var g = isDetailChart ? this.detailGraph : this.graphs[figure],
      opts = {
        file: this.history[this.server][figure],
        dateWindow: this.updateDateWindow(g, isDetailChart)
      };

      //round line chart values to 10th decimals
      var pointer = 0, dates = [];
      _.each(opts.file, function(value) {

        var rounded = value[0].getSeconds() - (value[0].getSeconds() % 10); 
        opts.file[pointer][0].setSeconds(rounded);
        dates.push(opts.file[pointer][0]);

        pointer++;
      });
      //get min/max dates of array
      var maxDate = new Date(Math.max.apply(null, dates));
      var minDate = new Date(Math.min.apply(null, dates));
      var tmpDate = new Date(minDate.getTime()), missingDates = [];
      var tmpDatesComplete = [];

      while (tmpDate < maxDate) {
        tmpDate = new Date(tmpDate.setSeconds(tmpDate.getSeconds() + 10));
        tmpDatesComplete.push(tmpDate);
      }

      //iterate through all date ranges
      _.each(tmpDatesComplete, function(date) {
        var tmp = false;

        //iterate through all available real date values
        _.each(opts.file, function(availableDates) {
          //if real date is inside date range
          if (Math.floor(date.getTime()/1000) === Math.floor(availableDates[0].getTime()/1000)) {
            tmp = true;
          }
        });

        if (tmp === false) {
          //a value is missing
          if (date < new Date()) {
            missingDates.push(date);
          }
        }
      });

      _.each(missingDates, function(date) {
        if (figure === 'systemUserTime' ||
            figure === 'requests' ||
            figure === 'pageFaults' ||
            figure === 'dataTransfer') {
          opts.file.push([date, 0, 0]);
        }
        if (figure === 'totalTime') {
          opts.file.push([date, 0, 0, 0]);
        }
      });

      if (opts.file === undefined) {
        $('#loadingScreen span').text('Statistics not ready yet. Waiting.');
        $('#loadingScreen').show();
        $('#content').hide();
      }
      else {
        $('#content').show();
        $('#loadingScreen').hide();

        //sort for library
        opts.file.sort(function(a,b){
          return new Date(b[0]) - new Date(a[0]);
        });

        g.updateOptions(opts);
        
        //clean up history
        if (this.history[this.server].hasOwnProperty(figure)) {
          this.cleanupHistory(figure);
        }
      }
      $(window).trigger('resize');
      this.resize();
    },

    mergeDygraphHistory: function (newData, i) {
      var self = this, valueList;

      this.dygraphConfig.getDashBoardFigures(true).forEach(function (f) {

        // check if figure is known
        if (! self.dygraphConfig.mapStatToFigure[f]) {
          return;
        }

        // need at least an empty history
        if (! self.history[self.server][f]) {
          self.history[self.server][f] = [];
        }

        // generate values for this key
        valueList = [];

        self.dygraphConfig.mapStatToFigure[f].forEach(function (a) {
          if (! newData[a]) {
            return;
          }

          if (a === "times") {
            valueList.push(new Date(newData[a][i] * 1000));
          }
          else {
            valueList.push(newData[a][i]);
          }
        });

        // if we found at list one value besides times, then use the entry
        if (valueList.length > 1) {

          // HTTP requests combine all types to one
          // 0: date, 1: GET", 2: "PUT", 3: "POST", 4: "DELETE", 5: "PATCH",
          // 6: "HEAD", 7: "OPTIONS", 8: "OTHER"
          //
          var read = 0, write = 0;
          if (valueList.length === 9) {

            read += valueList[1];
            read += valueList[6];
            read += valueList[7];
            read += valueList[8];

            write += valueList[2];
            write += valueList[3];
            write += valueList[4];
            write += valueList[5];

            valueList = [valueList[0], read, write];
          }

          self.history[self.server][f].push(valueList);
        }
      });
		},

    cutOffHistory: function (f, cutoff) {
      var self = this, v;

      while (self.history[self.server][f].length !== 0) {
        v = self.history[self.server][f][0][0];

        if (v >= cutoff) {
          break;
        }

        self.history[self.server][f].shift();
      }
    },

    cutOffDygraphHistory: function (cutoff) {
      var self = this;
      var cutoffDate = new Date(cutoff);

      this.dygraphConfig.getDashBoardFigures(true).forEach(function (f) {

        // check if figure is known
        if (! self.dygraphConfig.mapStatToFigure[f]) {
          return;
        }

        // history must be non-empty
        if (! self.history[self.server][f]) {
          return;
        }

        self.cutOffHistory(f, cutoffDate);
      });
    },

    mergeHistory: function (newData) {
      var self = this, i;

      for (i = 0; i < newData.times.length; ++i) {
        this.mergeDygraphHistory(newData, i);
      }

      this.cutOffDygraphHistory(new Date().getTime() - this.defaultTimeFrame);

      // convert tendency values
      Object.keys(this.tendencies).forEach(function (a) {
        var n1 = 1;
        var n2 = 1;

        if (a === "virtualSizeCurrent" || a === "virtualSizeAverage") {
          newData[self.tendencies[a][0]] /= (1024 * 1024 * 1024);
          n1 = 2;
        }
        else if (a === "clientConnectionsCurrent") {
          n1 = 0;
        }
        else if (a === "numberOfThreadsCurrent") {
          n1 = 0;
        }

        self.history[self.server][a] = [
          fmtNumber(newData[self.tendencies[a][0]], n1),
          fmtNumber(newData[self.tendencies[a][1]] * 100, n2)
        ];
      });

      // update distribution
      Object.keys(this.barCharts).forEach(function (a) {
        self.history[self.server][a] = self.mergeBarChartData(self.barCharts[a], newData);
      });

      // update physical memory
      self.history[self.server].physicalMemory = newData.physicalMemory;
      self.history[self.server].residentSizeCurrent = newData.residentSizeCurrent;
      self.history[self.server].residentSizePercent = newData.residentSizePercent;

      // generate chart description
      self.history[self.server].residentSizeChart =
      [
        {
          "key": "",
          "color": this.dygraphConfig.colors[1],
          "values": [
            {
              label: "used",
              value: newData.residentSizePercent * 100
            }
          ]
        },
        {
          "key": "",
          "color": this.dygraphConfig.colors[2],
          "values": [
            {
              label: "used",
              value: 100 - newData.residentSizePercent * 100
            }
          ]
        }
      ]
      ;

      // remember next start
      this.nextStart = newData.nextStart;
    },

    mergeBarChartData: function (attribList, newData) {
      var i, v1 = {
        "key": this.barChartsElementNames[attribList[0]],
        "color": this.dygraphConfig.colors[1],
        "values": []
      }, v2 = {
        "key": this.barChartsElementNames[attribList[1]],
        "color": this.dygraphConfig.colors[2],
        "values": []
      };
      for (i = newData[attribList[0]].values.length - 1;  0 <= i;  --i) {
        v1.values.push({
          label: this.getLabel(newData[attribList[0]].cuts, i),
          value: newData[attribList[0]].values[i]
        });
        v2.values.push({
          label: this.getLabel(newData[attribList[1]].cuts, i),
          value: newData[attribList[1]].values[i]
        });
      }
      return [v1, v2];
    },

    getLabel: function (cuts, counter) {
      if (!cuts[counter]) {
        return ">" + cuts[counter - 1];
      }
      return counter === 0 ? "0 - " +
                         cuts[counter] : cuts[counter - 1] + " - " + cuts[counter];
    },

    renderReplicationStatistics: function(object) {
      $('#repl-numbers table tr:nth-child(1) > td:nth-child(2)').html(object.state.totalEvents);
      $('#repl-numbers table tr:nth-child(2) > td:nth-child(2)').html(object.state.totalRequests);
      $('#repl-numbers table tr:nth-child(3) > td:nth-child(2)').html(object.state.totalFailedConnects);

      if (object.state.lastAppliedContinuousTick) {
        $('#repl-ticks table tr:nth-child(1) > td:nth-child(2)').html(object.state.lastAppliedContinuousTick);
      }
      else {
        $('#repl-ticks table tr:nth-child(1) > td:nth-child(2)').html("no data available").addClass('no-data');
      }
      if (object.state.lastProcessedContinuousTick) {
        $('#repl-ticks table tr:nth-child(2) > td:nth-child(2)').html(object.state.lastProcessedContinuousTick);
      }
      else {
        $('#repl-ticks table tr:nth-child(2) > td:nth-child(2)').html("no data available").addClass('no-data');
      }
      if (object.state.lastAvailableContinuousTick) {
        $('#repl-ticks table tr:nth-child(3) > td:nth-child(2)').html(object.state.lastAvailableContinuousTick);
      }
      else {
        $('#repl-ticks table tr:nth-child(3) > td:nth-child(2)').html("no data available").addClass('no-data');
      }

      $('#repl-progress table tr:nth-child(1) > td:nth-child(2)').html(object.state.progress.message);
      $('#repl-progress table tr:nth-child(2) > td:nth-child(2)').html(object.state.progress.time);
      $('#repl-progress table tr:nth-child(3) > td:nth-child(2)').html(object.state.progress.failedConnects);
    },

    getReplicationStatistics: function() {
      var self = this;

      $.ajax(
        arangoHelper.databaseUrl('/_api/replication/applier-state'),
        {async: true}
      ).done(
        function (d) {
          if (d.hasOwnProperty('state')) {
            var running;
            if (d.state.running) {
              running = "active";
            }
            else {
              running = "inactive";
            }
            running = '<span class="state">' + running + '</span>';
            $('#replication-chart .dashboard-sub-bar').html("Replication " + running);

            self.renderReplicationStatistics(d);
          }
      });
    },

    getStatistics: function (callback, modalView) {
      var self = this;
      var url = arangoHelper.databaseUrl("/_admin/aardvark/statistics/short", "_system");
      var urlParams = "?start=";

      if (self.nextStart) {
        urlParams += self.nextStart;
      }
      else {
        urlParams += (new Date().getTime() - self.defaultTimeFrame) / 1000;
      }

      if (self.server !== "-local-") {
        urlParams += "&type=short&DBserver=" + self.serverInfo.target;

        if (! self.history.hasOwnProperty(self.server)) {
          self.history[self.server] = {};
        }
      }
      console.log(url);

      $.ajax(
        url + urlParams,
        { 
          async: true,
          xhrFields: {
            withCredentials: true
          },
          crossDomain: true
        }
      ).done(
        function (d) {
          if (d.times.length > 0) {
            self.isUpdating = true;
            self.mergeHistory(d);
          }
          if (self.isUpdating === false) {
            return;
          }
          if (callback) {
            callback(d.enabled, modalView);
          }
          self.updateCharts();
      }).error(function(e) {
        console.log("stat fetch req error");
        console.log(e);
      });

      this.getReplicationStatistics();
    },

    getHistoryStatistics: function (figure) {
      var self = this;
      var url = "statistics/long";

      var urlParams
        = "?filter=" + this.dygraphConfig.mapStatToFigure[figure].join();

      if (self.server !== "-local-") {
        url = self.server.endpoint + arangoHelper.databaseUrl("/_admin/aardvark/statistics/cluster");
        urlParams += "&type=long&DBserver=" + self.server.target;

        if (! self.history.hasOwnProperty(self.server)) {
          self.history[self.server] = {};
        }
      }

      var origin = window.location.href.split("/"), 
      preUrl = origin[0] + '//' + origin[2] + '/' + origin[3] + '/_system/' + origin[5] + '/' + origin[6] + '/';

      $.ajax(
        preUrl + url + urlParams,
        {async: true}
      ).done(
        function (d) {
          var i;

          self.history[self.server][figure] = [];

          for (i = 0;  i < d.times.length;  ++i) {
            self.mergeDygraphHistory(d, i, true);
          }
        }
      );
    },

    addEmptyDataLabels: function () {
      if ($('.dataNotReadyYet').length === 0) {
        $('#dataTransferDistribution').prepend('<p class="dataNotReadyYet"> data not ready yet </p>');
        $('#totalTimeDistribution').prepend('<p class="dataNotReadyYet"> data not ready yet </p>');
        $('.dashboard-bar-chart-title').append('<p class="dataNotReadyYet"> data not ready yet </p>');
      }
    },

    removeEmptyDataLabels: function () {
      $('.dataNotReadyYet').remove();
    },

    prepareResidentSize: function (update) {

      var self = this;

      var dimensions = this.getCurrentSize('#residentSizeChartContainer');

      var current = self.history[self.server].residentSizeCurrent / 1024 / 1024;
      
      var currentA = "";

      if (current < 1025) {
        currentA = fmtNumber(current, 2) + " MB";
      }
      else {
        currentA = fmtNumber(current / 1024, 2) + " GB";
      }

      var currentP = fmtNumber(self.history[self.server].residentSizePercent * 100, 2);
      var data = [fmtNumber(self.history[self.server].physicalMemory / 1024 / 1024 / 1024, 0) + " GB"];


      if (self.history[self.server].residentSizeChart === undefined) {
        this.addEmptyDataLabels();
        return;
      }
      else {
        this.removeEmptyDataLabels();
      }

      nv.addGraph(function () {
        var chart = nv.models.multiBarHorizontalChart()
          .x(function (d) {
            return d.label;
          })
          .y(function (d) {
            return d.value;
          })
          .width(dimensions.width)
          .height(dimensions.height)
          .margin({
            top: ($("residentSizeChartContainer").outerHeight() - $("residentSizeChartContainer").height()) / 2,
            right: 1,
            bottom: ($("residentSizeChartContainer").outerHeight() - $("residentSizeChartContainer").height()) / 2,
            left: 1
          })
          .showValues(false)
          .showYAxis(false)
          .showXAxis(false)
          //.transitionDuration(100)
          //.tooltip(false)
          .showLegend(false)
          .showControls(false)
          .stacked(true);

        chart.yAxis
          .tickFormat(function (d) {return d + "%";})
          .showMaxMin(false);
        chart.xAxis.showMaxMin(false);

        d3.select('#residentSizeChart svg')
          .datum(self.history[self.server].residentSizeChart)
          .call(chart);

        d3.select('#residentSizeChart svg').select('.nv-zeroLine').remove();

        if (update) {
          d3.select('#residentSizeChart svg').select('#total').remove();
          d3.select('#residentSizeChart svg').select('#percentage').remove();
        }

        d3.select('.dashboard-bar-chart-title .percentage')
          .html(currentA + " ("+ currentP + " %)");

        d3.select('.dashboard-bar-chart-title .absolut')
          .html(data[0]);

        nv.utils.windowResize(chart.update);

        return chart;
      }, function() {
        d3.selectAll("#residentSizeChart .nv-bar").on('click',
          function() {
            // no idea why this has to be empty, well anyways...
          }
        );
      });
    },

    prepareD3Charts: function (update) {
      var self = this;
      var barCharts = {
        totalTimeDistribution: [
          "queueTimeDistributionPercent", "requestTimeDistributionPercent"],
        dataTransferDistribution: [
          "bytesSentDistributionPercent", "bytesReceivedDistributionPercent"]
      };

      if (this.d3NotInitialized) {
          update = false;
          this.d3NotInitialized = false;
      }

      _.each(Object.keys(barCharts), function (k) {

        var dimensions = self.getCurrentSize('#' + k
          + 'Container .dashboard-interior-chart');

        var selector = "#" + k + "Container svg";

        if (self.history[self.server].residentSizeChart === undefined) {
          self.addEmptyDataLabels();
          return;
        }
        else {
          self.removeEmptyDataLabels();
        }

        nv.addGraph(function () {
          var tickMarks = [0, 0.25, 0.5, 0.75, 1];
          var marginLeft = 75;
          var marginBottom = 23;
          var bottomSpacer = 6;

          if (dimensions.width < 219) {
            tickMarks = [0, 0.5, 1];
            marginLeft = 72;
            marginBottom = 21;
            bottomSpacer = 5;
          }
          else if (dimensions.width < 299) {
            tickMarks = [0, 0.3334, 0.6667, 1];
            marginLeft = 77;
          }
          else if (dimensions.width < 379) {
            marginLeft = 87;
          }
          else if (dimensions.width < 459) {
            marginLeft = 95;
          }
          else if (dimensions.width < 539) {
            marginLeft = 100;
          }
          else if (dimensions.width < 619) {
            marginLeft = 105;
          }

          var chart = nv.models.multiBarHorizontalChart()
            .x(function (d) {
              return d.label;
            })
            .y(function (d) {
              return d.value;
            })
            .width(dimensions.width)
            .height(dimensions.height)
            .margin({
              top: 5,
              right: 20,
              bottom: marginBottom,
              left: marginLeft
            })
            .showValues(false)
            .showYAxis(true)
            .showXAxis(true)
            //.transitionDuration(100)
            //.tooltips(false)
            .showLegend(false)
            .showControls(false)
            .forceY([0,1]);

          chart.yAxis
            .showMaxMin(false);

          var yTicks2 = d3.select('.nv-y.nv-axis')
            .selectAll('text')
            .attr('transform', 'translate (0, ' + bottomSpacer + ')') ;

          chart.yAxis
            .tickValues(tickMarks)
            .tickFormat(function (d) {return fmtNumber(((d * 100 * 100) / 100), 0) + "%";});

          d3.select(selector)
            .datum(self.history[self.server][k])
            .call(chart);

          nv.utils.windowResize(chart.update);

          return chart;
        }, function() {
          d3.selectAll(selector + " .nv-bar").on('click',
            function() {
              // no idea why this has to be empty, well anyways...
            }
          );
        });
      });

    },

    stopUpdating: function () {
      this.isUpdating = false;
    },

  startUpdating: function () {
    var self = this;
    if (self.timer) {
      return;
    }
    self.timer = window.setInterval(function () {

        if (window.App.isCluster) {
          if (window.location.hash.indexOf(self.serverInfo.target) > -1) {
            self.getStatistics();
          }
        }
        else {
          self.getStatistics();
        }
      },
      self.interval
    );
  },


  resize: function () {
    if (!this.isUpdating) {
      return;
    }
    var self = this, dimensions;
      _.each(this.graphs,function (g) {
      dimensions = self.getCurrentSize(g.maindiv_.id);
      g.resize(dimensions.width, dimensions.height);
    });
    if (this.detailGraph) {
      dimensions = this.getCurrentSize(this.detailGraph.maindiv_.id);
      this.detailGraph.resize(dimensions.width, dimensions.height);
    }
    this.prepareD3Charts(true);
    this.prepareResidentSize(true);
  },

  template: templateEngine.createTemplate("dashboardView.ejs"),

  render: function (modalView) {

    var callback = function(enabled, modalView) {
      if (!modalView)  {
        $(this.el).html(this.template.render());
      }

      if (!enabled || frontendConfig.db !== '_system') {
        $(this.el).html('');
        if (this.server) {
          $(this.el).append(
            '<div style="color: red">Server statistics (' + this.server + ') are disabled.</div>'
          );
        }
        else {
          $(this.el).append(
            '<div style="color: red">Server statistics are disabled.</div>'
          );
        }
        return;
      }

      this.prepareDygraphs();
      if (this.isUpdating) {
        this.prepareD3Charts();
        this.prepareResidentSize();
        this.updateTendencies();
        $(window).trigger('resize');
      }
      this.startUpdating();
      $(window).resize();
    }.bind(this);

    var errorFunction = function() {
        $(this.el).html('');
        $('.contentDiv').remove();
        $('.headerBar').remove();
        $('.dashboard-headerbar').remove();
        $('.dashboard-row').remove();
        $(this.el).append(
          '<div style="color: red">You do not have permission to view this page.</div>'
        );
        $(this.el).append(
          '<div style="color: red">You can switch to \'_system\' to see the dashboard.</div>'
        );
    }.bind(this);

    if (frontendConfig.db !== '_system') {
      errorFunction();
      return;
    }

    var callback2 = function(error, authorized) {
      if (!error) {
        if (!authorized) {
          errorFunction();
        }
        else {
          this.getStatistics(callback, modalView);
        }
      }
    }.bind(this);

    if (window.App.currentDB.get("name") === undefined) {
      window.setTimeout(function() {
        if (window.App.currentDB.get("name") !== '_system') {
          errorFunction();
          return;
        }
        //check if user has _system permission
        this.options.database.hasSystemAccess(callback2);
      }.bind(this), 300);
    }
    else {
      //check if user has _system permission
      this.options.database.hasSystemAccess(callback2);
    }

  }
});
}());
